# Spon Milestone 3.5 — MCP API, Phase 1 (headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local stdio MCP server (`packages/mcp`) lets Claude create, open and edit Spon jobs on disk, import models, pick geometry by short handles, add operations, generate and post G-code, see a PNG preview of the toolpaths, export G-code and save `.spon` files. The results are identical to the web app's.

**Architecture:**
- First, the generate → post → analyse pipeline, the model-loading helpers and the export checks move from `packages/web` into a new `core/src/pipeline/` folder. This is a behaviour-preserving refactor; the web worker and state become thin callers.
- `packages/mcp` holds:
  - a `JobSession` interface and its file-backed implementation `FileSession`;
  - a geometry handle map, the `~/.spon/tools.json` library, and a zod schema for `JobCommand`;
  - the MCP tool layer.
- The preview is drawn as SVG by a pure core function and rasterised to PNG with `@resvg/resvg-wasm`.
- The server is bundled with esbuild: core is bundled in, and npm dependencies stay external and are loaded from `node_modules`.

**Tech Stack:**
- TypeScript 7, Vitest 5, Node ≥ 22;
- `@modelcontextprotocol/sdk` 1.31 (MIT), `zod` 4 (MIT);
- `@resvg/resvg-wasm` 2.6.2 (MPL-2.0), `esbuild` 0.28 (MIT, dev only);
- `occt-import-js` 0.0.23 (LGPL-2.1, already accepted; unmodified, loaded from `node_modules`).

**Spec:** `docs/superpowers/specs/2026-09-30-mcp-api-design.md`. Read it together with this plan. It is the authority; this plan is its argument. Phase 2 (the live bridge, spec §6) is **not** in this plan.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs (its tsconfig lib is `ES2022` + `WebWorker`). It never imports `occt-import-js`: the reader is injected.
- No GPL dependencies. The only new runtime dependencies are `@modelcontextprotocol/sdk` (MIT), `zod` (MIT) and `@resvg/resvg-wasm` (MPL-2.0), in `@sponcam/mcp` only. `occt-import-js` is added to `@sponcam/mcp` pinned to exactly `0.0.23`. `esbuild` is a dev dependency.
- The web app's behaviour does not change. Existing web unit tests and Playwright tests pass; only their import paths may change, and moved tests keep their assertions.
- All lengths are in mm, and all coordinates in tool results are program coordinates (relative to the WCS origin), matching `describeGeometry`.
- Tool failures are MCP results with `isError: true` and a message. They are never thrown as protocol errors.
- Logging goes to **stderr only**. Stdout carries the stdio protocol.
- Fixed messages (copy verbatim):
  - `No job open. Use new_job or open_job.` (phase 1 wording; phase 2 adds `use_live_tab`)
  - `The current job has unsaved changes — save_job first, or pass discard: true`
  - `This job has not been saved yet — give a path`
  - `Unknown handle <h> — call describe_geometry for the current list`
- `TypeScript` runs with `verbatimModuleSyntax`: use `import type` for type-only imports.
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line.
- Never push, and never rewrite history. Leave the user's dev server on port 5173 alone.

## Clarifications to the spec (binding for this plan)

1. **No `use_live_tab` in phase 1.** It is registered in phase 2. In phase 1, `status` reports `liveTab: null`.
2. **No MCP output schemas.** Every tool returns `structuredContent` (always a JSON object) plus text, without declaring an `outputSchema`, which keeps the tool list compact. The SDK only validates structured content when an output schema is declared.
3. **No machine-travel check.** `MachineProfile` has no travel limits, so `generate` compares the toolpath extents with the **stock** only.
4. **Arcs in the preview are tessellated in every view** (the spec allowed SVG arcs in `top`). This keeps one code path for decimation.
5. **Font.** The web app's Geist font is woff2 only, and resvg reads TTF/OTF only. The OFL `Geist-Regular.ttf` from the `geist@1.7.2` npm tarball is vendored as `packages/mcp/assets/Geist-Regular.ttf` together with its licence. The `geist` package is not a dependency, because it has a Next.js peer dependency.
6. **Bundling.** `dist/spon-mcp.js` bundles `@sponcam/core` and core's own dependencies. Every dependency of `@sponcam/mcp` stays external and is loaded from `packages/mcp/node_modules`, so the bundle runs in place inside the repo checkout after `pnpm install`. `occt-import-js` is therefore never bundled or modified.
7. **`JobSession` gains `boxes()`**, which returns `{ model: BBox | null; stock: BBox | null }` in program coordinates. `describe_geometry` and `generate` need it, and the spec lists both boxes in their results.
8. **`runPipeline` returns `{ run: CamRun; toolpaths: Toolpath[] }`.** The web worker transfers only `run`. The file session keeps the toolpaths for the preview.
9. **Tool library merge moves to core.** `mergeToolLibrary` and `parseToolLibraryFile` in `core/src/tools/library.ts` hold the web app's current import logic (same-id replaces; a taken T number moves to the next free one). The web app and the MCP library file both use them.
10. **A new job starts clean.** `new_job` creates an unsaved but clean job (`dirty: false`), so an untouched new job never blocks switching. The first change makes it dirty. This refines spec §3.1.
11. **Preview layers are drawn in a fixed order** (stock, model, problems, toolpaths, WCS, legend, scale) instead of sorted by depth. Line drawings don't hide one another.

## Review Focus

1. **A relative path** (`import_model { path: "part.dxf" }`) resolves against the server's working directory, and every filesystem error names the resolved absolute path. → Task 11 tests a relative import, a missing file and a missing folder.
2. **Reopening a saved job gives the same G-code.** A `.spon` saved by the server and reopened gives an equal job and byte-identical posted files, including for STEP models, which go through the Node reader on reopen. → Task 8 round-trip tests, for DXF and STEP.
3. **A stale handle after importing a new model** gives the "Unknown handle" message, not a confusing `ref-missing` later. → Task 12 test.
4. **A library tool whose T number is already used in the job by a different tool** makes `add_operation` fail cleanly with nothing applied. → Task 12 test.
5. **Very large toolpaths** keep the preview small: 100,000 moves render to fewer than 20,000 SVG path commands. → Task 5 test.

---

## File map

**Core — new `packages/core/src/pipeline/`**
- `model.ts` — `ModelGeometry`, `SuccessfulImport`, `toModelGeometry`, `suggestedUnits`, `placementFor`, `programOrigin`, `programContext` (moved from web).
- `importFlow.ts` — `ImportStep`, `importStep`, `defaultBody` (moved from web).
- `readModel.ts` — `OCCT_PARAMS`, `OcctParams`, `OcctReader`, `OcctLoader`, `importModel(fileName, bytes, body, loadReader)` (moved from web, with the reader injected).
- `run.ts` — `OperationSummary`, `GeneratedFile`, `CamRun`, `PipelineResult`, `PipelineCache`, `runPipeline`.
- `export.ts` — `ExportInput`, `exportProblems`, `exportFiles`, `exportInputFromRun`.

**Core — new `packages/core/src/preview/`**
- `project.ts` — view vectors and projection.
- `svg.ts` — `PreviewInput`, `PreviewOptions`, `previewInput`, `renderPreviewSvg`.
- `simplify.ts` — screen-space polyline decimation.

**Core — modified:** `src/index.ts` (exports) and `src/tools/library.ts` (`mergeToolLibrary`, `parseToolLibraryFile`).

**Web — modified:**
- `state/store.ts`, `state/documents.ts`, `state/cam.ts`, `state/programs.ts`, `state/selectors.ts`, `state/camTypes.ts`, `state/export.ts`, `state/toolLibrary.ts`;
- `workers/import.worker.ts`, `workers/occtReader.ts`;
- `dock/AnalysisView.tsx`, `viewport/CamOverlays.tsx`, `viewport/Toolpaths.tsx`, `layout/BodyDialog.tsx`.

**Web — deleted (moved to core):** `state/geometry.ts`, `state/placement.ts`, `state/programContext.ts`, `state/importFlow.ts`, `workers/modelImport.ts`, and their tests.

**New package `packages/mcp`**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `scripts/build.mjs`, `README.md`, `assets/Geist-Regular.ttf`, `assets/OFL.txt`
- `src/main.ts` — stdio entry point.
- `src/server.ts` — `createSponServer(deps)`.
- `src/context.ts` — `ServerDeps`, `ToolContext` and `createContext`.
- `src/state.ts` — the current session and handles.
- `src/session.ts` — the `JobSession` interface, outcome types and `SessionError`.
- `src/fileSession.ts` — `FileSession`.
- `src/handles.ts` — `HandleMap` and catalog text.
- `src/library.ts` — `ToolLibraryFile`.
- `src/occt.ts` — `loadNodeOcct`.
- `src/raster.ts` — `svgToPng`.
- `src/schemas.ts` — zod schemas, including `jobCommandSchema`.
- `src/instructions.ts` — server instructions and the prompt text.
- `src/log.ts` — logging to stderr.
- `src/tools/result.ts`, `src/tools/session.ts`, `src/tools/edit.ts`, `src/tools/output.ts`, `src/tools/library.ts`, `src/resources.ts`
- `test/helpers.ts` and the test files named in each task.

**Root:** `package.json` (`mcp:build` script), `THIRD_PARTY_NOTICES.md`, `.claude/skills/spon-dev/SKILL.md`.

---

### Task 1: Core pipeline — model geometry, placement, program context, import flow

Move four pure web modules into core without changing their behaviour.

**Files:**
- Create: `packages/core/src/pipeline/model.ts`, `packages/core/src/pipeline/importFlow.ts`
- Create (moved tests): `packages/core/test/pipeline-model.test.ts`, `packages/core/test/pipeline-importFlow.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/web/src/state/store.ts`, `documents.ts`, `cam.ts`, `programs.ts`, `selectors.ts`, `packages/web/src/dock/AnalysisView.tsx`, `packages/web/src/viewport/CamOverlays.tsx`, `packages/web/src/viewport/Toolpaths.tsx`, `packages/web/src/layout/BodyDialog.tsx`
- Delete: `packages/web/src/state/geometry.ts`, `geometry.test.ts`, `placement.ts`, `placement.test.ts`, `programContext.ts`, `programContext.test.ts`, `importFlow.ts`, `importFlow.test.ts`

**Interfaces:**
- Produces (exported from `@sponcam/core`):
  - `type ModelGeometry = { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array; source?: CadSource } | { kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array }`
  - `type SuccessfulImport = Extract<ImportResult, { ok: true; kind: 'mesh' | 'drawing' }>`
  - `toModelGeometry(result: SuccessfulImport): ModelGeometry`
  - `suggestedUnits(result: SuccessfulImport): LengthUnit`
  - `placementFor(model: ModelRef, geometry: ModelGeometry): Placement | null`
  - `programOrigin(job: Job, geometry: ModelGeometry | null): Vec3`
  - `programContext(job: Job, geometry: ModelGeometry | null): ProgramContext`
  - `type ImportStep`, `importStep(result: ImportResult): ImportStep`, `defaultBody(bodies: readonly CadBodySummary[]): number`

- [ ] **Step 1: Move the tests first (they fail: the core modules don't exist yet)**

Create `packages/core/test/pipeline-model.test.ts` by concatenating the bodies of `packages/web/src/state/geometry.test.ts`, `placement.test.ts` and `programContext.test.ts`, with one merged import block at the top:

```ts
import { describe, expect, it } from 'vitest';
import {
  createJob, importFile, type ModelGeometry, type ModelRef, placementFor, programContext, programOrigin, setModel, suggestedUnits,
  toModelGeometry, vec3,
} from '../src';
```

Keep every `describe`/`it` block and assertion unchanged. Only the imports change (`./geometry`, `./placement`, `./programContext`, `./store` and `@sponcam/core` all become `../src`).

Create `packages/core/test/pipeline-importFlow.test.ts` from `packages/web/src/state/importFlow.test.ts`:
- Replace its imports with `import { readFileSync } from 'node:fs'; import { describe, expect, it } from 'vitest'; import { cadImport, defaultBody, importFile, importStep, type OcctResult } from '../src';`, plus any other names the file uses from `@sponcam/core`.
- Change the fixture URL from `` `../../../core/test/fixtures/${name}.occt.json` `` to `` `./fixtures/${name}.occt.json` ``.

- [ ] **Step 2: Run the moved tests to verify they fail**

Run: `pnpm --filter @sponcam/core test pipeline-`
Expected: FAIL, with `placementFor`, `importStep` and the other new names not exported from `../src`.

- [ ] **Step 3: Create `packages/core/src/pipeline/model.ts`**

```ts
import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import { pathsToPoints } from '../geometry/path2d';
import { v3sub, type Vec3, vec3 } from '../geometry/vec3';
import type { ProgramContext } from '../gcode/program';
import type { Drawing } from '../import/dxf/dxf';
import type { CadSource, ImportResult } from '../import/importFile';
import { suggestStlUnits } from '../import/stl';
import { computePlacement, type Placement, stockBox, wcsPoint } from '../job/derive';
import type { Job, ModelRef } from '../job/types';
import type { LengthUnit } from '../units/units';

/** The loaded model as the web app and the MCP server keep it (a CamGeometry plus import details). */
export type ModelGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array; source?: CadSource }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array };

export type SuccessfulImport = Extract<ImportResult, { ok: true; kind: 'mesh' | 'drawing' }>;

export function toModelGeometry(result: SuccessfulImport): ModelGeometry {
  if (result.kind === 'mesh') {
    return {
      kind: 'mesh', mesh: result.mesh, adjacency: result.adjacency, diagnostics: result.diagnostics, rawPoints: result.mesh.positions,
      ...(result.source ? { source: result.source } : {}),
    };
  }
  return { kind: 'drawing', drawing: result.drawing, rawPoints: pathsToPoints(result.drawing.layers.flatMap((l) => l.paths)) };
}

/** Units to pre-select in the units dialog: detected units if any, else a guess from the size. */
export function suggestedUnits(result: SuccessfulImport): LengthUnit {
  if (result.detectedUnits) return result.detectedUnits;
  return result.kind === 'mesh' ? suggestStlUnits(result.mesh) : 'mm';
}

// ModelRef objects are replaced on every edit and geometry on every load, so identity caching is exact
const cache = new WeakMap<ModelRef, WeakMap<ModelGeometry, Placement | null>>();

/** The model's placement, computed once per (model, geometry) pair and shared by every caller. */
export function placementFor(model: ModelRef, geometry: ModelGeometry): Placement | null {
  let byGeometry = cache.get(model);
  if (!byGeometry) {
    byGeometry = new WeakMap();
    cache.set(model, byGeometry);
  }
  if (byGeometry.has(geometry)) return byGeometry.get(geometry) ?? null;
  const placement = computePlacement(model, geometry.rawPoints);
  byGeometry.set(geometry, placement);
  return placement;
}

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

- [ ] **Step 4: Create `packages/core/src/pipeline/importFlow.ts`**

This is the content of `packages/web/src/state/importFlow.ts`, with its imports pointing inside core:

```ts
import type { CadBodySummary, CadFormat, ImportResult } from '../import/importFile';
import type { LengthUnit } from '../units/units';
import type { SuccessfulImport } from './model';

/** What an import flow does with a reader result. */
export type ImportStep =
  | { kind: 'error'; error: string }
  | { kind: 'chooseBody'; format: CadFormat; bodies: CadBodySummary[] }
  /** `units` null: the units must be asked for. */
  | { kind: 'ready'; result: SuccessfulImport; units: LengthUnit | null };

export function importStep(result: ImportResult): ImportStep {
  if (!result.ok) return { kind: 'error', error: result.error };
  if (result.kind === 'bodies') return { kind: 'chooseBody', format: result.format, bodies: result.bodies };
  return { kind: 'ready', result, units: result.detectedUnits };
}

/** The body pre-selected in the body dialog: the largest bounding box volume, the first one on ties. */
export function defaultBody(bodies: readonly CadBodySummary[]): number {
  let best = 0;
  let bestVolume = -1;
  bodies.forEach((b, i) => {
    const volume = b.size.x * b.size.y * b.size.z;
    if (volume > bestVolume) {
      best = i;
      bestVolume = volume;
    }
  });
  return best;
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from './pipeline/model';
export * from './pipeline/importFlow';
```

- [ ] **Step 5: Run the core tests**

Run: `pnpm --filter @sponcam/core test pipeline-`
Expected: PASS.

- [ ] **Step 6: Point the web app at core and delete the web copies**

- `packages/web/src/state/store.ts`:
  - delete the local `export type ModelGeometry = …` declaration;
  - add `type ModelGeometry` to the existing `@sponcam/core` import;
  - add the line `export type { ModelGeometry } from '@sponcam/core';` so existing `import { type ModelGeometry } from './store'` / `'@/state/store'` callers keep working.
- `state/documents.ts`: remove `import { suggestedUnits, toModelGeometry } from './geometry';` and `import { importStep } from './importFlow';`, and add `importStep, suggestedUnits, toModelGeometry` to its `@sponcam/core` import.
- `state/cam.ts` and `state/programs.ts`: replace `import { programContext } from './programContext';` with `programContext` in the `@sponcam/core` import. (`cam.ts` currently imports only a type from core, so add `import { programContext } from '@sponcam/core';`.)
- `state/selectors.ts`: `placementFor` now comes from `@sponcam/core`.
- `dock/AnalysisView.tsx`, `viewport/Toolpaths.tsx`: `programOrigin` from `@sponcam/core`. `viewport/CamOverlays.tsx`: `programContext, programOrigin` from `@sponcam/core`.
- `layout/BodyDialog.tsx`: `defaultBody` from `@sponcam/core`.
- Delete `packages/web/src/state/{geometry,placement,programContext,importFlow}.ts` and their four `.test.ts` files.

Run `grep -rn "state/\(geometry\|placement\|programContext\|importFlow\)'\|from '\./\(geometry\|placement\|programContext\|importFlow\)'" packages/web/src`. Expected: no output.

- [ ] **Step 7: Verify nothing changed for the app**

Run: `pnpm typecheck && pnpm --filter @sponcam/web test && pnpm --filter @sponcam/core test`
Expected: all PASS. The web test count drops by exactly the number of tests moved, and the core count rises by the same number.

- [ ] **Step 8: Commit**

```bash
git add -A packages/core packages/web
git commit -m "refactor: model geometry, placement, program context and import flow move to core"
```

---

### Task 2: Core pipeline — `runPipeline` and export checks

**Files:**
- Create: `packages/core/src/pipeline/run.ts`, `packages/core/src/pipeline/export.ts`
- Test: `packages/core/test/pipeline-run.test.ts`, `packages/core/test/pipeline-export.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/web/src/workers/import.worker.ts`, `packages/web/src/state/camTypes.ts`, `packages/web/src/state/export.ts`

**Interfaces:**
- Consumes: `programContext`, `toModelGeometry`, `ModelGeometry` (Task 1); `generateJob`, `GenerationCache`, `postProcess`, `PostOptions`, `parseProgram`, `describeGeometry`.
- Produces:
  - `interface OperationSummary { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays; hasToolpath: boolean }`
  - `interface GeneratedFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[]; parsed: ParsedProgram; postErrors: Diagnostic[] }`
  - `interface CamRun { results: OperationSummary[]; files: GeneratedFile[]; catalog: GeometryCatalog | null }`
  - `interface PipelineResult { run: CamRun; toolpaths: Toolpath[] }`
  - `class PipelineCache { readonly generation: GenerationCache; catalogFor(job: Job, geometry: CamGeometry | null): GeometryCatalog | null }`
  - `runPipeline(job: Job, geometry: CamGeometry | null, ctx: ProgramContext, cache?: PipelineCache, opts?: PostOptions): PipelineResult`
  - `interface ExportInput { jobName: string; operations: readonly { id: string; name: string }[]; results: Readonly<Record<string, { diagnostics: readonly CamDiagnostic[] } | undefined>>; files: readonly ExportFileInput[] }`
  - `interface ExportFileInput { name: string; text: string; postErrors: readonly Diagnostic[]; analysisDiagnostics: readonly Diagnostic[] }`
  - `exportProblems(input: ExportInput): { errors: string[]; warnings: string[] }`
  - `exportFiles(input: ExportInput): { name: string; bytes: Uint8Array }`
  - `exportInputFromRun(job: Job, run: CamRun): ExportInput`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/pipeline-run.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, createJob, importFile, type Job, type JobCommand, PipelineCache, programContext, runPipeline, setModel, setStock, toModelGeometry,
} from '../src';
import { tool6 } from './fixtures/camSetup';

function outlineJob() {
  const r = importFile('cam-part.dxf', readFileSync(new URL('./fixtures/cam-part.dxf', import.meta.url)));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry = toModelGeometry(r);
  const outline = r.drawing.layers.findIndex((l) => l.name === 'OUTLINE');
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: outline, path: 0 }] } },
  ];
  const job: Job = commands.reduce(applyCommand, setModel(createJob('Part'), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }));
  return { job, geometry };
}

describe('runPipeline', () => {
  it('generates, posts, parses and describes in one call', () => {
    const { job, geometry } = outlineJob();
    const { run, toolpaths } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' });
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ operationId: 'p', hasToolpath: true });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(toolpaths).toHaveLength(1);
    expect(run.files).toHaveLength(1);
    expect(run.files[0].text).toContain('Spon 2026-01-01');
    expect(run.files[0].postErrors).toEqual([]);
    expect(run.files[0].parsed.analysis.summary.totalSeconds).toBeGreaterThan(0);
    expect(run.catalog?.contours.length).toBeGreaterThan(0);
  });

  it('reuses cached operation results and the catalog', () => {
    const { job, geometry } = outlineJob();
    const cache = new PipelineCache();
    const ctx = programContext(job, geometry);
    const a = runPipeline(job, geometry, ctx, cache);
    const b = runPipeline(job, geometry, ctx, cache);
    expect(b.toolpaths[0]).toBe(a.toolpaths[0]);
    expect(b.run.catalog).toBe(a.run.catalog);
    const moved = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
    expect(runPipeline(moved, geometry, programContext(moved, geometry), cache).run.catalog).not.toBe(a.run.catalog);
  });

  it('reports errors and no catalog without a model', () => {
    const job = applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    const { run, toolpaths } = runPipeline(job, null, programContext(job, null));
    expect(run.catalog).toBeNull();
    expect(toolpaths).toEqual([]);
    expect(run.files).toEqual([]);
    expect(run.results[0].diagnostics[0]).toMatchObject({ severity: 'error', code: 'no-tool' });
  });
});
```

`packages/core/test/pipeline-export.test.ts`: the pure half of the web test, written against `ExportInput`:

```ts
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ExportFileInput, type ExportInput, exportFiles, exportProblems } from '../src';

const file = (over: Partial<ExportFileInput> = {}): ExportFileInput => ({ name: 'a.nc', text: 'G0 X1\n', postErrors: [], analysisDiagnostics: [], ...over });
const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  jobName: 'My Part', operations: [{ id: 'o', name: 'Pocket 1' }], results: { o: { diagnostics: [] } }, files: [file()], ...over,
});
const diag = (severity: 'error' | 'warning', code: string, message: string, line = 0) => ({ line, severity, code, message }) as never;

describe('export checks', () => {
  it('blocks on operation and post errors, warns on warnings and analysis findings', () => {
    expect(exportProblems(input())).toEqual({ errors: [], warnings: [] });
    const warned = input({
      results: { o: { diagnostics: [{ operationId: 'o', severity: 'warning', code: 'unmachined-area', message: 'Corners' }] } },
      files: [file({ analysisDiagnostics: [diag('error', 'below-stock-bottom', 'Too deep', 4)] })],
    });
    expect(exportProblems(warned)).toEqual({ errors: [], warnings: ['Pocket 1: Corners', 'a.nc line 5: Too deep'] });
    const failed = input({
      results: { o: { diagnostics: [{ operationId: 'o', severity: 'error', code: 'no-tool', message: 'Choose a tool' }] } },
      files: [file({ postErrors: [diag('error', 'feed-no-f', 'No F')] })],
    });
    expect(exportProblems(failed).errors).toEqual(['Pocket 1: Choose a tool', 'a.nc: post-processor produced invalid G-code (No F)']);
    expect(exportProblems(input({ files: [] })).errors).toEqual(['Nothing to export: add operations with geometry']);
  });

  it('returns one file directly and several as a zip named after the job', () => {
    const one = exportFiles(input());
    expect(one.name).toBe('a.nc');
    expect(new TextDecoder().decode(one.bytes)).toBe('G0 X1\n');
    const two = input({ files: [file(), file({ name: 'b.nc', text: 'G0 X2\n' })] });
    const zip = exportFiles(two);
    expect(zip.name).toBe('My_Part.zip');
    const files = unzipSync(zip.bytes);
    expect(Object.keys(files)).toEqual(['a.nc', 'b.nc']);
    expect(strFromU8(files['b.nc'])).toBe('G0 X2\n');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/core test pipeline-run pipeline-export`
Expected: FAIL (`runPipeline`, `PipelineCache`, `exportProblems` not exported).

- [ ] **Step 3: Create `packages/core/src/pipeline/run.ts`**

```ts
import type { CamGeometry } from '../cam/context';
import { describeGeometry, type GeometryCatalog } from '../cam/features/describe';
import { GenerationCache, generateJob } from '../cam/generate';
import type { ResolvedHeights } from '../cam/heights';
import type { OpOverlays } from '../cam/ops/output';
import type { CamDiagnostic, Toolpath } from '../cam/types';
import { type ParsedProgram, parseProgram, type ProgramContext } from '../gcode/program';
import type { Diagnostic } from '../gcode/types';
import type { Job } from '../job/types';
import { type PostOptions, postProcess, type PostSection } from '../post/engine';

export interface OperationSummary { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays; hasToolpath: boolean }
export interface GeneratedFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[]; parsed: ParsedProgram; postErrors: Diagnostic[] }
export interface CamRun { results: OperationSummary[]; files: GeneratedFile[]; catalog: GeometryCatalog | null }
/** `run` is what the web worker sends back; `toolpaths` stay with the caller (the MCP preview uses them). */
export interface PipelineResult { run: CamRun; toolpaths: Toolpath[] }

/** Per-operation results and the geometry catalog, kept between runs for one loaded model. */
export class PipelineCache {
  readonly generation = new GenerationCache();
  private catalogKey = '';
  private catalogGeometry: CamGeometry | null = null;
  private catalog: GeometryCatalog | null = null;

  catalogFor(job: Job, geometry: CamGeometry | null): GeometryCatalog | null {
    const key = JSON.stringify([job.model, job.stock, job.wcs, job.tolerance]);
    if (key !== this.catalogKey || geometry !== this.catalogGeometry) {
      this.catalog = geometry && job.model ? describeGeometry(job, geometry) : null;
      this.catalogKey = key;
      this.catalogGeometry = geometry;
    }
    return this.catalog;
  }
}

/** Generates every operation, posts, parses and analyses the files, and describes the geometry. */
export function runPipeline(job: Job, geometry: CamGeometry | null, ctx: ProgramContext, cache = new PipelineCache(), opts: PostOptions = {}): PipelineResult {
  const results = generateJob(job, geometry, cache.generation);
  const toolpaths = results.flatMap((r) => (r.toolpath ? [r.toolpath] : []));
  const encoder = new TextEncoder();
  const files = postProcess(job, toolpaths, opts).map((f) => {
    const parsed = parseProgram(encoder.encode(f.text), ctx);
    return { ...f, parsed, postErrors: parsed.interpretDiagnostics.filter((d) => d.severity === 'error') };
  });
  const summaries = results.map(({ operationId, diagnostics, heights, overlays, toolpath }) => ({ operationId, diagnostics, heights, overlays, hasToolpath: toolpath !== null }));
  return { run: { results: summaries, files, catalog: cache.catalogFor(job, geometry) }, toolpaths };
}
```

If `GenerationCache` is only exported as a type from `generate.ts` in a way that clashes with the value import, keep it as a value import: it is a class.

- [ ] **Step 4: Create `packages/core/src/pipeline/export.ts`**

```ts
import { strToU8, zipSync } from 'fflate';
import type { CamDiagnostic } from '../cam/types';
import type { Diagnostic } from '../gcode/types';
import type { Job } from '../job/types';
import { sanitizeName } from '../post/format';
import type { CamRun } from './run';

export interface ExportFileInput { name: string; text: string; postErrors: readonly Diagnostic[]; analysisDiagnostics: readonly Diagnostic[] }
export interface ExportInput {
  jobName: string;
  operations: readonly { id: string; name: string }[];
  results: Readonly<Record<string, { diagnostics: readonly CamDiagnostic[] } | undefined>>;
  files: readonly ExportFileInput[];
}

/** Errors block an export; warnings need the user's confirmation (web) or are relayed (MCP). */
export function exportProblems(input: ExportInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const op of input.operations) {
    for (const d of input.results[op.id]?.diagnostics ?? []) (d.severity === 'error' ? errors : warnings).push(`${op.name}: ${d.message}`);
  }
  for (const f of input.files) {
    for (const d of f.postErrors) errors.push(`${f.name}: post-processor produced invalid G-code (${d.message})`);
    for (const d of f.analysisDiagnostics) warnings.push(`${f.name} line ${d.line + 1}: ${d.message}`);
  }
  if (!input.files.length) errors.push('Nothing to export: add operations with geometry');
  return { errors, warnings };
}

/** One file as it is, several as a zip named after the job. */
export function exportFiles(input: ExportInput): { name: string; bytes: Uint8Array } {
  const files = input.files;
  if (files.length === 1) return { name: files[0].name, bytes: strToU8(files[0].text) };
  return { name: `${sanitizeName(input.jobName)}.zip`, bytes: zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))) };
}

export function exportInputFromRun(job: Job, run: CamRun): ExportInput {
  return {
    jobName: job.name,
    operations: job.operations,
    results: Object.fromEntries(run.results.map((r) => [r.operationId, r])),
    files: run.files.map((f) => ({ name: f.name, text: f.text, postErrors: f.postErrors, analysisDiagnostics: f.parsed.analysis.diagnostics })),
  };
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from './pipeline/run';
export * from './pipeline/export';
```

- [ ] **Step 5: Run the core tests**

Run: `pnpm --filter @sponcam/core test pipeline-`
Expected: PASS.

- [ ] **Step 6: Make the web worker, `camTypes` and `export.ts` thin callers**

`packages/web/src/state/camTypes.ts`: delete the local `OperationSummary`, `GeneratedFile` and `CamRun` interfaces and re-export them. The file becomes:

```ts
import type { Diagnostic, HeightName, PostSection } from '@sponcam/core';

export type { CamRun, GeneratedFile, OperationSummary } from '@sponcam/core';
export interface CamFile { name: string; blobId: string; operationIds: string[]; sections: PostSection[]; postErrors: Diagnostic[] }
export type CamPickTarget = 'geometry' | { height: HeightName };
export type InspectorTab = 'geometry' | 'tool' | 'heights' | 'passes';
```

Keep whatever other imports the existing file needs. Check the current first line and drop names that are no longer used, or `noUnusedLocals` will fail.

`packages/web/src/workers/import.worker.ts`:
- Replace the `GenerationCache`/`catalogKey`/`catalog` module state with `let pipeline = new PipelineCache();`.
- Change `setCamModel` to `camGeometry = geometry; pipeline = new PipelineCache();`.
- Replace the body of `generate`:

```ts
  generate(job: Job, ctx: ProgramContext): CamRun {
    const { run } = runPipeline(job, camGeometry, ctx, pipeline);
    return Comlink.transfer(run, run.files.flatMap((f) => parsedProgramTransferables(f.parsed)));
  },
```

Update its core import: remove the names that are no longer used (`describeGeometry`, `GenerationCache`, `generateJob`, `GeometryCatalog`, `postProcess`), and add `PipelineCache, runPipeline`. `CamRun` can come from `@sponcam/core` directly.

`packages/web/src/state/export.ts`: keep `ExportState`, `downloadBytes` and `exportGcode` unchanged. Replace the bodies of `exportProblems` and `exportFiles`:

```ts
import { type ExportInput, exportFiles as filesOf, exportProblems as problemsOf } from '@sponcam/core';

export function toExportInput(s: ExportState): ExportInput {
  return {
    jobName: s.job.name,
    operations: s.job.operations,
    results: s.camResults,
    files: s.camFiles.map((f) => {
      const data = s.programData[f.blobId];
      return { name: f.name, text: data?.text ?? '', postErrors: f.postErrors, analysisDiagnostics: data?.parsed?.analysis.diagnostics ?? [] };
    }),
  };
}

export const exportProblems = (s: ExportState): { errors: string[]; warnings: string[] } => problemsOf(toExportInput(s));
export const exportFiles = (s: ExportState): { name: string; bytes: Uint8Array } => filesOf(toExportInput(s));
```

Remove the now-unused `sanitizeName`, `strToU8` and `zipSync` imports. `packages/web/src/state/export.test.ts` stays unchanged and must still pass.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm --filter @sponcam/core test && pnpm --filter @sponcam/web test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages/core packages/web
git commit -m "refactor: the CAM pipeline and export checks move to core"
```

---

### Task 3: Core pipeline — `importModel` with an injected reader

**Files:**
- Create: `packages/core/src/pipeline/readModel.ts`
- Test: `packages/core/test/pipeline-readModel.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/web/src/workers/occtReader.ts`, `packages/web/src/workers/import.worker.ts`
- Delete: `packages/web/src/workers/modelImport.ts`, `packages/web/src/workers/modelImport.test.ts`

**Interfaces:**
- Produces:
  - `OCCT_PARAMS` (the same values as the current web constant), `type OcctParams = typeof OCCT_PARAMS`
  - `interface OcctReader { ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult; ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult }`
  - `type OcctLoader = () => Promise<OcctReader>`
  - `importModel(fileName: string, bytes: Uint8Array, body: number | undefined, loadReader: OcctLoader): Promise<ImportResult>`

- [ ] **Step 1: Write the failing test** (a port of `modelImport.test.ts` with a fake loader instead of `vi.mock`)

`packages/core/test/pipeline-readModel.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importModel, OCCT_PARAMS, type OcctReader } from '../src';

const reader = { ReadStepFile: vi.fn(), ReadIgesFile: vi.fn() };
const loadReader = vi.fn(async () => reader as unknown as OcctReader);
const recorded = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.occt.json`, import.meta.url), 'utf8'));
const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));
const BYTES = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  loadReader.mockImplementation(async () => reader as unknown as OcctReader);
});

describe('importModel', () => {
  it('never loads the reader for STL or DXF', async () => {
    const r = await importModel('part.stl', STL, undefined, loadReader);
    expect(r.ok && r.kind).toBe('mesh');
    await importModel('part.dxf', new TextEncoder().encode('0\nEOF\n'), undefined, loadReader);
    expect(loadReader).not.toHaveBeenCalled();
  });

  it('reads STEP with the fixed parameters and returns the body with its source', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('box-hole.step'));
    const r = await importModel('bracket.STP', BYTES, undefined, loadReader);
    expect(loadReader).toHaveBeenCalledOnce();
    expect(reader.ReadStepFile).toHaveBeenCalledWith(BYTES, OCCT_PARAMS);
    expect(reader.ReadIgesFile).not.toHaveBeenCalled();
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.source).toEqual({ format: 'step', body: 0, bodies: 1, name: 'Bracket' });
  });

  it('reads IGES with ReadIgesFile', async () => {
    reader.ReadIgesFile.mockReturnValue(recorded('box.iges'));
    const r = await importModel('box.igs', BYTES, undefined, loadReader);
    expect(reader.ReadIgesFile).toHaveBeenCalledWith(BYTES, OCCT_PARAMS);
    expect(r.ok && r.kind === 'mesh' && r.source?.format).toBe('iges');
  });

  it('lists bodies until one is chosen', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('two-bodies.step'));
    const list = await importModel('two.step', BYTES, undefined, loadReader);
    expect(list.ok && list.kind).toBe('bodies');
    const chosen = await importModel('two.step', BYTES, 1, loadReader);
    expect(chosen.ok && chosen.kind === 'mesh' && chosen.source?.name).toBe('Large block');
  });

  it('reports reader crashes and load failures', async () => {
    reader.ReadStepFile.mockImplementation(() => { throw new Error('abort'); });
    expect(await importModel('bad.step', BYTES, undefined, loadReader)).toEqual({ ok: false, error: 'Not a readable STEP file' });
    loadReader.mockRejectedValue(new Error('offline'));
    expect(await importModel('bad.iges', BYTES, undefined, loadReader)).toEqual({ ok: false, error: 'Could not load the IGES reader: offline' });
  });

  it('keeps the tessellation parameters fixed', () => {
    expect(OCCT_PARAMS).toEqual({ linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.01, angularDeflection: (0.5 * Math.PI) / 180 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/core test pipeline-readModel`
Expected: FAIL (`importModel`, `OCCT_PARAMS` not exported).

- [ ] **Step 3: Create `packages/core/src/pipeline/readModel.ts`**

```ts
import { CAD_LABEL, cadImport, type OcctResult } from '../import/cad';
import { cadFormat, type ImportResult, importFile } from '../import/importFile';

/** Tessellation settings. Fixed, so the same file always gives the same triangles (face references depend on it). */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: (0.5 * Math.PI) / 180,
} as const;

export type OcctParams = typeof OCCT_PARAMS;

/** The occt-import-js (LGPL-2.1) functions Spon calls. Core never imports the reader; callers inject a loader. */
export interface OcctReader {
  ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult;
}

export type OcctLoader = () => Promise<OcctReader>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a model file. STEP/IGES go through the injected reader (loaded on first use); STL and DXF never touch it. */
export async function importModel(fileName: string, bytes: Uint8Array, body: number | undefined, loadReader: OcctLoader): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes);
  let reader: OcctReader;
  try {
    reader = await loadReader();
  } catch (err) {
    return { ok: false, error: `Could not load the ${CAD_LABEL[format]} reader: ${message(err)}` };
  }
  let result: OcctResult;
  try {
    result = format === 'step' ? reader.ReadStepFile(bytes, OCCT_PARAMS) : reader.ReadIgesFile(bytes, OCCT_PARAMS);
  } catch {
    result = { success: false }; // the WASM reader aborts on some malformed files
  }
  return cadImport(result, format, body);
}
```

Append `export * from './pipeline/readModel';` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the core test**

Run: `pnpm --filter @sponcam/core test pipeline-readModel`
Expected: PASS.

- [ ] **Step 5: Web uses the core function**

`packages/web/src/workers/occtReader.ts`: delete `OCCT_PARAMS`, `OcctParams` and `OcctReader`, and add `import type { OcctReader } from '@sponcam/core';`. Keep `loadOcct` exactly as it is. Also drop the now-unused `import type { OcctResult }`.

`packages/web/src/workers/import.worker.ts`: remove `import { importModel } from './modelImport';`, add `importModel` to the `@sponcam/core` import, and change the call to `await importModel(fileName, bytes, body, loadOcct)`.

Delete `packages/web/src/workers/modelImport.ts` and `modelImport.test.ts`.

Run `grep -rn "modelImport\|OCCT_PARAMS" packages/web/src`. Expected: no output.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm --filter @sponcam/core test && pnpm --filter @sponcam/web test && pnpm build`
Expected: all PASS. The build still emits the lazily loaded occt chunk: `ls packages/web/dist/assets | grep -i occt` lists the `.wasm`.

- [ ] **Step 7: Run the STEP/IGES and CAM e2e tests (the worker changed)**

Run: `pnpm e2e && pnpm e2e:preview`
Expected: PASS (Playwright uses ports 5199 and 5198; the user's 5173 is not touched).

- [ ] **Step 8: Commit**

```bash
git add -A packages/core packages/web
git commit -m "refactor: model import with an injected STEP/IGES reader moves to core"
```

---
### Task 4: `packages/mcp` scaffold and the Node STEP/IGES reader

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/vitest.config.ts`
- Create: `packages/mcp/src/occt.ts`, `packages/mcp/src/log.ts`, `packages/mcp/src/version.ts`
- Create: `packages/mcp/test/helpers.ts`, `packages/mcp/test/occt.test.ts`
- Modify: `package.json` (root: `mcp:build` script), `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: `importModel`, `cadImport`, `OcctReader` (Task 3).
- Produces:
  - `loadNodeOcct(): Promise<OcctReader>` — loads occt-import-js once per process, unmodified, from `node_modules`; a failed load is forgotten.
  - `log(message: string): void` and `debugLog(message: string): void` — both write to stderr; `debugLog` only when `SPON_MCP_LOG=debug`.
  - `VERSION = '0.1.0'`.
  - Test helpers: `fixturePath(name)`, `fixture(name): Uint8Array`, `tempDir(): string`, `tool6: Tool`.

- [ ] **Step 1: Create the package**

`packages/mcp/package.json`:

```json
{
  "name": "@sponcam/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "spon-mcp": "./dist/spon-mcp.js" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.31.0",
    "@resvg/resvg-wasm": "2.6.2",
    "@sponcam/core": "workspace:^",
    "occt-import-js": "0.0.23",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^22",
    "esbuild": "^0.28.2",
    "typescript": "^7",
    "vitest": "^5"
  }
}
```

`packages/mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`packages/mcp/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
```

`packages/mcp/src/version.ts`:

```ts
export const VERSION = '0.1.0';
```

`packages/mcp/src/log.ts`:

```ts
/** Stdout carries the MCP protocol, so everything the server says goes to stderr. */
export function log(message: string): void {
  process.stderr.write(`[spon-mcp] ${message}\n`);
}

export function debugLog(message: string): void {
  if (process.env.SPON_MCP_LOG === 'debug') log(message);
}
```

In the root `package.json` scripts, add `"mcp:build": "pnpm --filter @sponcam/mcp build"`.

Run: `pnpm install`
Expected: the lockfile gains `@sponcam/mcp` and its dependencies. `packages/mcp/node_modules/occt-import-js` exists.

- [ ] **Step 2: Write the test helpers and the failing reader test**

`packages/mcp/test/helpers.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@sponcam/core';

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../../core/test/fixtures/${name}`, import.meta.url));
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));
export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'spon-mcp-'));

export const tool6: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};
```

`packages/mcp/test/occt.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { cadImport, importModel, type OcctResult } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { loadNodeOcct } from '../src/occt';
import { fixture, fixturePath } from './helpers';

const recorded = (name: string) => cadImport(JSON.parse(readFileSync(fixturePath(`${name}.occt.json`), 'utf8')) as OcctResult, name.endsWith('.iges') ? 'iges' : 'step');

describe('loadNodeOcct', () => {
  it('reads STEP in Node exactly like the recorded browser output', async () => {
    const live = await importModel('box-hole.step', fixture('box-hole.step'), undefined, loadNodeOcct);
    const saved = recorded('box-hole.step');
    if (!live.ok || live.kind !== 'mesh' || !saved.ok || saved.kind !== 'mesh') throw new Error('expected meshes');
    expect(live.source).toEqual(saved.source);
    expect(live.mesh.indices.length).toBe(saved.mesh.indices.length);
    expect(Array.from(live.mesh.faceIds ?? [])).toEqual(Array.from(saved.mesh.faceIds ?? []));
  });

  it('lists the bodies of a multi-body STEP file and reads IGES', async () => {
    const bodies = await importModel('two-bodies.step', fixture('two-bodies.step'), undefined, loadNodeOcct);
    expect(bodies.ok && bodies.kind === 'bodies' && bodies.bodies.length).toBe(2);
    const iges = await importModel('box.iges', fixture('box.iges'), undefined, loadNodeOcct);
    expect(iges.ok && iges.kind === 'mesh' && iges.source?.format).toBe('iges');
  });

  it('loads the reader once per process', () => {
    expect(loadNodeOcct()).toBe(loadNodeOcct());
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test occt`
Expected: FAIL (cannot resolve `../src/occt`).

- [ ] **Step 4: Implement `packages/mcp/src/occt.ts`**

```ts
import { createRequire } from 'node:module';
import type { OcctReader } from '@sponcam/core';

// named so it never clashes with the esbuild banner's `require` (see scripts/build.mjs)
const requireFromHere = createRequire(import.meta.url);
let reader: Promise<OcctReader> | null = null;

/**
 * Loads occt-import-js (LGPL-2.1) once per process, unmodified, from node_modules; the Emscripten glue finds its
 * .wasm next to itself. It is never bundled. A failed load is forgotten, so the next file tries again.
 */
export function loadNodeOcct(): Promise<OcctReader> {
  if (!reader) {
    const loading = Promise.resolve().then(() => (requireFromHere('occt-import-js') as () => Promise<OcctReader>)());
    loading.catch(() => {
      if (reader === loading) reader = null;
    });
    reader = loading;
  }
  return reader;
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `pnpm --filter @sponcam/mcp test occt && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

If the face-id comparison fails while the triangle counts match, the Node reader's float output (which differs from the recording by up to 5e-7) welded differently. Do not loosen the test. Report it, because face references in saved jobs depend on this.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml packages/mcp
git commit -m "feat(mcp): package scaffold and the Node STEP/IGES reader"
```

---

### Task 5: Core preview renderer — `renderPreviewSvg`

A pure SVG line drawing of the stock, the model, the WCS and the toolpaths, in one of three orthographic views.

**Files:**
- Create: `packages/core/src/preview/project.ts`, `packages/core/src/preview/simplify.ts`, `packages/core/src/preview/svg.ts`
- Test: `packages/core/test/preview.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `camContext`, `toProgram`, `drawingPathToProgram` (`cam/context.ts`); `flattenPath`; `PipelineResult` (Task 2); `toDisplay`, `fromDisplay`, `formatLength`.
- Produces:
  - `type PreviewView = 'top' | 'front' | 'iso'`, `PREVIEW_VIEWS`, `projector(view): (p: Vec3) => { x: number; y: number; depth: number }`
  - `simplifyPolyline(points: readonly number[], minStep?: number, maxDeviation?: number): number[]`
  - `interface PreviewOperation { id: string; name: string; toolpath: Toolpath | null; hasErrors: boolean; unmachined: OpOverlays['unmachined'] }`
  - `interface PreviewInput { job: Job; geometry: CamGeometry | null; operations: PreviewOperation[] }`
  - `interface PreviewOptions { view?: PreviewView; size?: number; operations?: readonly string[] }`
  - `previewInput(job: Job, geometry: CamGeometry | null, pipeline: PipelineResult): PreviewInput`
  - `renderPreviewSvg(input: PreviewInput, options?: PreviewOptions): string`
  - `niceLength(value: number): number`, `PREVIEW_PALETTE: readonly string[]`

SVG structure (tests and the MCP layer rely on it):
- a root `<svg width height viewBox font-family="Geist, sans-serif">`;
- a white background `<rect>`, and `<defs>` with the `hatch` pattern;
- `<g id="stock">`: a `<polygon>` for the stock top face in the `top` and `iso` views, plus the 12 box edges;
- `<g id="model">`;
- `<g class="unmachined">`;
- one `<g id="op-<i>" data-name="…">` per shown operation, containing `<path class="rapid" stroke-dasharray="4 3">`, `<path class="feed">`, and a `<circle>` for each drilled hole;
- `<g id="wcs">`, `<g id="legend">`, `<g id="scale">`, and `<text id="dims">`.

Layers are drawn in that fixed order. Line drawings don't hide one another, so there is no depth sort (the spec's "back to front" was for filled faces). `projector` still returns `depth` for later use.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand, type JobCommand, niceLength, PipelineCache, type PreviewInput, previewInput, programContext, projector, renderPreviewSvg, runPipeline,
  simplifyPolyline, type Toolpath,
} from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function profiled() {
  const { job: base, geometry, layer } = camPartSetup();
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p', name: 'Outline' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: layer('OUTLINE'), path: 0 }] } },
  ];
  const job = commands.reduce(applyCommand, base);
  // camPartSetup's geometry is a drawing CamGeometry with Float32Array raw points, i.e. a valid ModelGeometry
  const pipeline = runPipeline(job, geometry, programContext(job, geometry as never), new PipelineCache());
  return { job, geometry, input: previewInput(job, geometry, pipeline) };
}

const count = (text: string, needle: string) => text.split(needle).length - 1;
const pathOf = (svg: string, cls: string) => new RegExp(`class="${cls}" d="([^"]*)"`).exec(svg)?.[1] ?? '';

describe('projector', () => {
  it('maps program coordinates to each view', () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(projector('top')(p)).toEqual({ x: 1, y: 2, depth: 3 });
    expect(projector('front')(p)).toEqual({ x: 1, y: 3, depth: -2 });
    const up = projector('iso')({ x: 0, y: 0, z: 1 });
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(Math.cos(Math.PI / 6), 12);
  });
});

describe('simplifyPolyline', () => {
  it('drops collinear and sub-pixel points and keeps corners', () => {
    expect(simplifyPolyline([0, 0, 1, 0, 2, 0, 3, 0])).toEqual([0, 0, 3, 0]);
    expect(simplifyPolyline([0, 0, 0.1, 0.1, 5, 0])).toEqual([0, 0, 5, 0]);
    expect(simplifyPolyline([0, 0, 5, 0, 5, 5])).toEqual([0, 0, 5, 0, 5, 5]);
  });
});

describe('niceLength', () => {
  it('rounds down to 1, 2 or 5 × 10^k', () => {
    expect(niceLength(37)).toBe(20);
    expect(niceLength(100)).toBe(100);
    expect(niceLength(0.7)).toBeCloseTo(0.5, 12);
  });
});

describe('renderPreviewSvg', () => {
  it('draws the stock, the model, each operation, the WCS, a legend and a scale', () => {
    const { input } = profiled();
    expect(input.operations).toHaveLength(1);
    expect(input.operations[0].toolpath).not.toBeNull();
    const svg = renderPreviewSvg(input);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    for (const part of ['<g id="stock"', '<g id="model"', '<g id="op-0" data-name="Outline"', '<g id="wcs"', '<g id="legend"', '<g id="scale"', 'id="dims"']) {
      expect(svg).toContain(part);
    }
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(pathOf(svg, 'feed').length).toBeGreaterThan(0);
    expect(Number(/width="(\d+)"/.exec(svg)![1])).toBeLessThanOrEqual(1024);
  });

  it('renders the three views differently and fills the stock top except in the front view', () => {
    const { input } = profiled();
    const [top, front, iso] = (['top', 'front', 'iso'] as const).map((view) => renderPreviewSvg(input, { view }));
    expect(new Set([top, front, iso]).size).toBe(3);
    expect(top).toContain('<polygon');
    expect(iso).toContain('<polygon');
    expect(front).not.toContain('<polygon');
  });

  it('shows only the requested operations and escapes names', () => {
    const { input } = profiled();
    const named: PreviewInput = { ...input, operations: [{ ...input.operations[0], name: 'A <&> "B"' }] };
    expect(renderPreviewSvg(named)).toContain('A &lt;&amp;&gt; &quot;B&quot;');
    expect(renderPreviewSvg(input, { operations: [] })).not.toContain('id="op-0"');
  });

  it('marks operations with errors, unmachined areas and drill cycles', () => {
    const { input } = profiled();
    const cycle: Toolpath = {
      operationId: 'd', operationName: 'Drill', toolId: 't6', rpm: 1000, coolant: 'off', clearance: 10,
      moves: [{ kind: 'rapid', to: { x: 5, y: 5, z: 10 } }, { kind: 'cycle', cycle: 'drill', at: { x: 5, y: 5 }, top: 0, bottom: -6, r: 2, retract: 10, peck: 0, dwell: 0, feed: 100 }],
    };
    const svg = renderPreviewSvg({
      ...input,
      operations: [
        { ...input.operations[0], hasErrors: true, unmachined: [{ z: -3, regions: [{ outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], holes: [] }] }] },
        { id: 'd', name: 'Drill', toolpath: cycle, hasErrors: false, unmachined: [] },
      ],
    });
    expect(svg).toContain('Outline — error');
    expect(svg).toContain('class="unmachined"');
    expect(svg).toContain('url(#hatch)');
    expect(svg).toContain('<circle');
  });

  it('keeps 100,000 moves under 20,000 path commands (review focus 5)', () => {
    const { input } = profiled();
    const moves = Array.from({ length: 100_000 }, (_, i) => {
      const a = (i / 100_000) * 2 * Math.PI;
      return { kind: 'line' as const, to: { x: 20 * Math.cos(a), y: 20 * Math.sin(a), z: -1 }, feed: 1000 };
    });
    const big: Toolpath = { operationId: 'big', operationName: 'Big', toolId: 't6', rpm: 1, coolant: 'off', clearance: 5, moves: [{ kind: 'rapid', to: { x: 20, y: 0, z: 5 } }, ...moves] };
    const started = performance.now();
    const svg = renderPreviewSvg({ ...input, operations: [{ id: 'big', name: 'Big', toolpath: big, hasErrors: false, unmachined: [] }] });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(count(pathOf(svg, 'feed'), 'L')).toBeLessThan(20_000);
  });

  it('says there is nothing to preview without a model', () => {
    const { input } = profiled();
    const svg = renderPreviewSvg({ job: { ...input.job, model: null }, geometry: null, operations: [] });
    expect(svg).toContain('Nothing to preview: import a model first');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/core test preview`
Expected: FAIL (the preview exports don't exist).

- [ ] **Step 3: Implement `packages/core/src/preview/project.ts`**

```ts
import type { Vec3 } from '../geometry/vec3';

export type PreviewView = 'top' | 'front' | 'iso';
export const PREVIEW_VIEWS: readonly PreviewView[] = ['top', 'front', 'iso'];

const R2 = Math.SQRT1_2;
const EL = Math.PI / 6; // iso: 30° above the horizon

/** Screen right, screen up and towards-the-viewer unit vectors (orthographic). */
const AXES: Readonly<Record<PreviewView, { right: Vec3; up: Vec3; toward: Vec3 }>> = {
  top: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, toward: { x: 0, y: 0, z: 1 } },
  front: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, toward: { x: 0, y: -1, z: 0 } },
  // seen from the front right (+X, −Y) at 45° azimuth
  iso: {
    right: { x: R2, y: R2, z: 0 },
    up: { x: -R2 * Math.sin(EL), y: R2 * Math.sin(EL), z: Math.cos(EL) },
    toward: { x: R2 * Math.cos(EL), y: -R2 * Math.cos(EL), z: Math.sin(EL) },
  },
};

/** A point on the drawing plane in mm (y up) and its depth (larger is nearer the viewer). */
export interface Projected { x: number; y: number; depth: number }

export function projector(view: PreviewView): (p: Vec3) => Projected {
  const { right: r, up: u, toward: t } = AXES[view];
  return (p) => ({
    x: p.x * r.x + p.y * r.y + p.z * r.z,
    y: p.x * u.x + p.y * u.y + p.z * u.z,
    depth: p.x * t.x + p.y * t.y + p.z * t.z,
  });
}
```

(`toEqual` treats `0` and `-0` as different. The top/front expectations above avoid `-0` because every product with a zero axis component is added to a non-zero term. If a platform still produces `-0`, compare with `toBeCloseTo` per field instead of changing the projector.)

- [ ] **Step 4: Implement `packages/core/src/preview/simplify.ts`**

```ts
/**
 * Screen-space decimation of a polyline given as flat [x0, y0, x1, y1, …] pixels. It drops points closer than
 * `minStep` to the last kept point, and points within `maxDeviation` of the segment from the last kept point to the
 * next point. The first and last points are always kept.
 */
export function simplifyPolyline(points: readonly number[], minStep = 0.5, maxDeviation = 0.25): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const out = [points[0], points[1]];
  let kx = points[0];
  let ky = points[1];
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (Math.hypot(x - kx, y - ky) < minStep) continue;
    const dx = points[i * 2 + 2] - kx;
    const dy = points[i * 2 + 3] - ky;
    const len2 = dx * dx + dy * dy;
    const along = (x - kx) * dx + (y - ky) * dy;
    if (len2 > 0 && along > 0 && along < len2 && Math.abs((x - kx) * dy - (y - ky) * dx) / Math.sqrt(len2) < maxDeviation) continue;
    out.push(x, y);
    kx = x;
    ky = y;
  }
  out.push(points[n * 2 - 2], points[n * 2 - 1]);
  return out;
}
```

- [ ] **Step 5: Implement `packages/core/src/preview/svg.ts`**

```ts
import { camContext, type CamContext, type CamGeometry, drawingPathToProgram, toProgram } from '../cam/context';
import type { OpOverlays } from '../cam/ops/output';
import type { Move, Toolpath } from '../cam/types';
import type { BBox } from '../geometry/bbox';
import { flattenPath } from '../geometry/offset/pathOps';
import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import type { PipelineResult } from '../pipeline/run';
import { formatLength, fromDisplay, toDisplay } from '../units/units';
import { type PreviewView, projector } from './project';
import { simplifyPolyline } from './simplify';

export interface PreviewOperation { id: string; name: string; toolpath: Toolpath | null; hasErrors: boolean; unmachined: OpOverlays['unmachined'] }
export interface PreviewInput { job: Job; geometry: CamGeometry | null; operations: PreviewOperation[] }
export interface PreviewOptions { view?: PreviewView; size?: number; operations?: readonly string[] }

export const PREVIEW_PALETTE: readonly string[] = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#4f46e5'];
const ERROR = '#dc2626';
const INK = '#111827';
const MARGIN = 32;
const ARC_STEP = (5 * Math.PI) / 180;
const COS_FEATURE = Math.cos(Math.PI / 6);

type ArcMove = Extract<Move, { kind: 'arc' }>;
type Polyline = Vec3[];
interface Runs { feed: Polyline[]; rapid: Polyline[]; drills: Vec3[] }

/** The enabled operations of a job with their toolpaths, errors and unmachined areas from a pipeline run. */
export function previewInput(job: Job, geometry: CamGeometry | null, pipeline: PipelineResult): PreviewInput {
  const summaries = new Map(pipeline.run.results.map((r) => [r.operationId, r]));
  const toolpaths = new Map(pipeline.toolpaths.map((t) => [t.operationId, t]));
  const operations = job.operations.filter((op) => op.enabled).map((op) => {
    const summary = summaries.get(op.id);
    return {
      id: op.id, name: op.name, toolpath: toolpaths.get(op.id) ?? null,
      hasErrors: !!summary?.diagnostics.some((d) => d.severity === 'error'),
      unmachined: summary?.overlays.unmachined ?? [],
    };
  });
  return { job, geometry, operations };
}

/** The largest 1, 2 or 5 × 10^k that is not above `value`. */
export function niceLength(value: number): number {
  const p = 10 ** Math.floor(Math.log10(value));
  const m = value / p;
  return Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(3));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
const f1 = (v: number) => v.toFixed(1);

function arcPoints(from: Vec3, m: ArcMove): Vec3[] {
  const c = m.center;
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(m.to.y - c.y, m.to.x - c.x);
  let sweep = m.ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 1e-9) sweep += 2 * Math.PI; // equal start and end: a full circle
  const n = Math.max(2, Math.ceil(sweep / ARC_STEP));
  const pts: Vec3[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = a0 + (m.ccw ? 1 : -1) * sweep * t;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z: from.z + (m.to.z - from.z) * t });
  }
  pts.push(m.to);
  return pts;
}

/** Splits a toolpath into runs of feed moves and runs of rapids; drill cycles become a feed down and a rapid up. */
function toolpathRuns(tp: Toolpath): Runs {
  const runs: Runs = { feed: [], rapid: [], drills: [] };
  let pos: Vec3 | null = null;
  let kind: 'feed' | 'rapid' | null = null;
  let run: Polyline = [];
  const add = (k: 'feed' | 'rapid', pts: Vec3[]) => {
    if (!pos) return;
    if (k !== kind) {
      run = [pos];
      runs[k].push(run);
      kind = k;
    }
    for (const p of pts) run.push(p);
  };
  for (const m of tp.moves) {
    if (m.kind === 'cycle') {
      const at = (z: number): Vec3 => ({ x: m.at.x, y: m.at.y, z });
      add('rapid', [at(m.r)]);
      pos = at(m.r);
      add('feed', [at(m.bottom)]);
      pos = at(m.bottom);
      add('rapid', [at(m.retract)]);
      pos = at(m.retract);
      runs.drills.push(at(m.top));
      continue;
    }
    add(m.kind === 'rapid' ? 'rapid' : 'feed', m.kind === 'arc' && pos ? arcPoints(pos, m) : [m.to]);
    pos = m.to;
  }
  return runs;
}

function boxCorner(b: BBox, i: number): Vec3 {
  return { x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z };
}
const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const boxEdges = (b: BBox): Polyline[] => BOX_EDGES.map(([a, c]) => [boxCorner(b, a), boxCorner(b, c)]);

/** Mesh: open edges and edges between faces more than 30° apart. Drawing: every path. In program coordinates. */
function modelLines(ctx: CamContext): Polyline[] {
  const g = ctx.geometry;
  if (!g || !ctx.placement) return [];
  if (g.kind === 'drawing') {
    const z = ctx.model?.max.z ?? 0;
    return g.drawing.layers.flatMap((l) => l.paths.map((p) => {
      const pts = flattenPath(drawingPathToProgram(ctx, p), 0.02).map((v): Vec3 => ({ x: v.x, y: v.y, z }));
      return p.closed && pts.length ? [...pts, pts[0]] : pts;
    }));
  }
  const { mesh, adjacency } = g;
  const pos = mesh.positions;
  const placed: Vec3[] = [];
  for (let i = 0; i < pos.length / 3; i++) placed.push(toProgram(ctx, { x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] }));
  const nm = mesh.normals;
  const lines: Polyline[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const o = adjacency.neighbors[t * 3 + e];
      if (o !== -1 && (o < t || nm[t * 3] * nm[o * 3] + nm[t * 3 + 1] * nm[o * 3 + 1] + nm[t * 3 + 2] * nm[o * 3 + 2] >= COS_FEATURE)) continue;
      lines.push([placed[mesh.indices[t * 3 + e]], placed[mesh.indices[t * 3 + ((e + 1) % 3)]]]);
    }
  }
  return lines;
}

function emptySvg(text: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120" font-family="Geist, sans-serif">'
    + `<rect width="480" height="120" fill="#ffffff"/><text x="240" y="64" text-anchor="middle" font-size="14" fill="#374151">${esc(text)}</text></svg>`;
}

function pathCommands(pts: readonly number[], close = false): string {
  if (pts.length < 4) return '';
  let out = `M${f1(pts[0])} ${f1(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) out += `L${f1(pts[i])} ${f1(pts[i + 1])}`;
  return close ? `${out}Z` : out;
}

/** An orthographic line drawing of the job: stock, model, toolpaths (feeds solid, rapids dashed), WCS, legend and scale. */
export function renderPreviewSvg(input: PreviewInput, options: PreviewOptions = {}): string {
  const view = options.view ?? 'top';
  const size = Math.min(2048, Math.max(256, Math.round(options.size ?? 1024)));
  const job = input.job;
  const ctx = camContext(job, input.geometry);
  const project = projector(view);
  const ops = input.operations.filter((op) => !options.operations || options.operations.includes(op.id));
  const stock = ctx.stock;
  const model = modelLines(ctx);
  const opRuns = ops.map((op): Runs => (op.toolpath ? toolpathRuns(op.toolpath) : { feed: [], rapid: [], drills: [] }));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const growAll = (lines: Polyline[]) => {
    for (const l of lines) {
      for (const p of l) {
        const q = project(p);
        if (q.x < minX) minX = q.x;
        if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
      }
    }
  };
  if (stock) growAll(boxEdges(stock));
  growAll(model);
  for (const r of opRuns) {
    growAll(r.feed);
    growAll(r.rapid);
  }
  if (!Number.isFinite(minX)) return emptySvg('Nothing to preview: import a model first');

  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const s = (size - 2 * MARGIN) / Math.max(w, h);
  const W = Math.max(320, Math.ceil(w * s + 2 * MARGIN));
  const H = Math.max(240, Math.ceil(h * s + 2 * MARGIN));
  const ox = (W - w * s) / 2;
  const oy = (H - h * s) / 2;
  const screen = (p: Vec3): [number, number] => {
    const q = project(p);
    return [ox + (q.x - minX) * s, H - (oy + (q.y - minY) * s)];
  };
  const flat = (line: Polyline): number[] => {
    const out: number[] = [];
    for (const p of line) {
      const [x, y] = screen(p);
      out.push(x, y);
    }
    return out;
  };
  const d = (lines: Polyline[], simplify: boolean) => lines.map((l) => pathCommands(simplify ? simplifyPolyline(flat(l)) : flat(l))).join('');
  const at = (v: Vec2, z: number): Vec3 => ({ x: v.x, y: v.y, z });

  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" stroke-width="1.5"/></pattern></defs>',
  ];
  if (stock) {
    const top = view === 'front' ? '' : `<polygon points="${[4, 5, 7, 6].map((i) => screen(boxCorner(stock, i)).map(f1).join(',')).join(' ')}" fill="#f3f4f6"/>`;
    parts.push(`<g id="stock" stroke="#9ca3af" stroke-width="1" fill="none">${top}<path d="${d(boxEdges(stock), false)}"/></g>`);
  }
  parts.push(`<g id="model" stroke="#4b5563" stroke-width="1" fill="none"><path d="${d(model, input.geometry?.kind === 'drawing')}"/></g>`);

  const regions = ops.flatMap((op) => op.unmachined.flatMap((u) => u.regions.map((r) =>
    [r.outer, ...r.holes].map((ring) => pathCommands(ring.flatMap((v) => screen(at(v, u.z))), true)).join(''))));
  if (regions.length) parts.push(`<g class="unmachined" fill="url(#hatch)" stroke="${ERROR}" stroke-width="1" fill-rule="evenodd"><path d="${regions.join('')}"/></g>`);

  ops.forEach((op, i) => {
    const color = PREVIEW_PALETTE[i % PREVIEW_PALETTE.length];
    const r = opRuns[i];
    const drills = r.drills.map((p) => {
      const [x, y] = screen(p);
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="4"/><path d="M${f1(x - 4)} ${f1(y)}L${f1(x + 4)} ${f1(y)}M${f1(x)} ${f1(y - 4)}L${f1(x)} ${f1(y + 4)}"/>`;
    }).join('');
    parts.push(
      `<g id="op-${i}" data-name="${esc(op.name)}" stroke="${color}" fill="none">`
      + `<path class="rapid" d="${d(r.rapid, true)}" stroke-width="0.75" stroke-dasharray="4 3" opacity="0.7"/>`
      + `<path class="feed" d="${d(r.feed, true)}" stroke-width="1.5"/>${drills}</g>`,
    );
  });

  const [cx, cy] = screen({ x: 0, y: 0, z: 0 });
  const axisMm = 28 / s;
  const axisEnds: [string, Vec3][] = [[ERROR, { x: axisMm, y: 0, z: 0 }], ['#16a34a', { x: 0, y: axisMm, z: 0 }], ['#2563eb', { x: 0, y: 0, z: axisMm }]];
  const axes = axisEnds.map(([color, p]) => {
    const [x, y] = screen(p);
    return Math.hypot(x - cx, y - cy) < 1 ? '' : `<path d="M${f1(cx)} ${f1(cy)}L${f1(x)} ${f1(y)}" stroke="${color}"/>`;
  }).join('');
  parts.push(`<g id="wcs" stroke-width="2">${axes}<text x="${f1(cx + 6)}" y="${f1(cy - 6)}" font-size="12" fill="${INK}">${job.wcs.workOffset}</text></g>`);

  if (ops.length) {
    const label = (op: PreviewOperation) => `${op.name}${op.hasErrors ? ' — error' : ''}`;
    const width = Math.min(W - 24, 48 + 7.5 * Math.max(...ops.map((op) => label(op).length)));
    const rows = ops.map((op, i) => {
      const y = 32 + 20 * i;
      const outline = op.hasErrors ? ` stroke="${ERROR}" stroke-width="2"` : '';
      return `<rect x="20" y="${y - 8}" width="16" height="6" fill="${PREVIEW_PALETTE[i % PREVIEW_PALETTE.length]}"${outline}/>`
        + `<text x="42" y="${y}" font-size="13" fill="${op.hasErrors ? ERROR : INK}">${esc(label(op))}</text>`;
    });
    parts.push(`<g id="legend"><rect x="12" y="12" width="${f1(width)}" height="${rows.length * 20 + 12}" fill="#ffffff" fill-opacity="0.85" stroke="#e5e7eb"/>${rows.join('')}</g>`);
  }

  const unit = job.displayUnits;
  const nice = niceLength(toDisplay(100 / s, unit));
  const px = fromDisplay(nice, unit) * s;
  parts.push(
    `<g id="scale" stroke="${INK}" stroke-width="2"><path d="M12 ${H - 14}L${f1(12 + px)} ${H - 14}M12 ${H - 19}L12 ${H - 9}M${f1(12 + px)} ${H - 19}L${f1(12 + px)} ${H - 9}"/>`
    + `<text x="12" y="${H - 24}" font-size="12" fill="${INK}" stroke="none">${nice} ${unit}</text></g>`,
  );
  if (stock) {
    const fmt = (mm: number) => formatLength(mm, unit, { withUnit: false });
    parts.push(`<text id="dims" x="${W - 12}" y="${H - 14}" text-anchor="end" font-size="12" fill="#374151">Stock ${fmt(stock.max.x - stock.min.x)} × ${fmt(stock.max.y - stock.min.y)} × ${fmt(stock.max.z - stock.min.z)} ${unit}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Geist, sans-serif">${parts.join('')}</svg>`;
}
```

Notes for the implementer:
- `camContext` returns `stock` and `model` in program coordinates. `toProgram` needs `ctx.placement`, which `modelLines` checks first.
- Read `core/src/units/units.ts` before using `formatLength`: if its options differ, use its no-unit form.
- `flat` pushes point by point, not with `flatMap`/spread, so 100,000-point runs don't build large temporary arrays.

Append to `packages/core/src/index.ts`:

```ts
export * from './preview/project';
export * from './preview/simplify';
export * from './preview/svg';
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/core test preview && pnpm --filter @sponcam/core typecheck`
Expected: PASS. The preview uses no DOM or Node API.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): SVG preview of stock, model, WCS and toolpaths"
```

---

### Task 6: PNG rasterising with resvg and the vendored Geist font

**Files:**
- Create (vendored): `packages/mcp/assets/Geist-Regular.ttf`, `packages/mcp/assets/OFL.txt`
- Create: `packages/mcp/src/raster.ts`
- Test: `packages/mcp/test/raster.test.ts`

**Interfaces:**
- Consumes: `renderPreviewSvg`, `previewInput`, `runPipeline` (core).
- Produces: `svgToPng(svg: string): Promise<Uint8Array>`, and `renderImage(svg: string): Promise<{ width: number; height: number; pixels: Uint8Array; png: Uint8Array }>`.

- [ ] **Step 1: Vendor the font**

```bash
cd packages/mcp
mkdir -p assets
npm pack geist@1.7.2 --silent
tar -tzf geist-1.7.2.tgz | grep -iE "geist-sans/Geist-Regular.ttf|licen|ofl"
```

Extract `package/dist/fonts/geist-sans/Geist-Regular.ttf` and the licence file the listing shows (the SIL Open Font License text). Move them to `assets/Geist-Regular.ttf` and `assets/OFL.txt`, then remove the leftovers:

```bash
tar -xzf geist-1.7.2.tgz package/dist/fonts/geist-sans/Geist-Regular.ttf <licence path from the listing>
mv package/dist/fonts/geist-sans/Geist-Regular.ttf assets/Geist-Regular.ttf
mv <extracted licence file> assets/OFL.txt
rm -rf package geist-1.7.2.tgz
cd ../..
```

Check that `assets/OFL.txt` is the SIL Open Font License 1.1. If the tarball has no licence file, stop and report it rather than writing one from memory.

- [ ] **Step 2: Write the failing test**

`packages/mcp/test/raster.test.ts`:

```ts
import { createHash } from 'node:crypto';
import {
  applyCommand, createJob, importFile, type JobCommand, PipelineCache, previewInput, programContext, renderPreviewSvg, runPipeline, setModel, toModelGeometry,
} from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { renderImage, svgToPng } from '../src/raster';
import { fixture, tool6 } from './helpers';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function outlineInput() {
  const r = importFile('cam-part.dxf', fixture('cam-part.dxf'));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry = toModelGeometry(r);
  const outline = r.drawing.layers.findIndex((l) => l.name === 'OUTLINE');
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: outline, path: 0 }] } },
  ];
  const job = commands.reduce(applyCommand, setModel(createJob('Part'), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }));
  return previewInput(job, geometry, runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' }));
}

describe('svgToPng', () => {
  it('returns a PNG the size of the SVG', async () => {
    const svg = renderPreviewSvg(outlineInput(), { size: 800 });
    const png = await svgToPng(svg);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(Number(/width="(\d+)"/.exec(svg)![1]));
  });

  it('draws text with the bundled font (there are no system fonts)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#fff"/><text x="10" y="42" font-size="36" font-family="Geist" fill="#000">Spon</text></svg>';
    const { pixels } = await renderImage(svg);
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) dark++;
    expect(dark).toBeGreaterThan(100);
  });

  it.each(['top', 'front', 'iso'] as const)('renders the %s view deterministically', async (view) => {
    const png = await svgToPng(renderPreviewSvg(outlineInput(), { view, size: 512 }));
    expect(createHash('sha256').update(png).digest('hex')).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test raster`
Expected: FAIL (cannot resolve `../src/raster`).

- [ ] **Step 4: Implement `packages/mcp/src/raster.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const requireFromHere = createRequire(import.meta.url);
// src/raster.ts and dist/spon-mcp.js both sit one level below the package root
const FONT = new URL('../assets/Geist-Regular.ttf', import.meta.url);
let ready: Promise<Uint8Array> | null = null;

/** Loads the resvg WebAssembly (once per process: initWasm throws when called twice) and the font. */
function init(): Promise<Uint8Array> {
  if (!ready) {
    const loading = (async () => {
      await initWasm(await readFile(requireFromHere.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      return new Uint8Array(await readFile(FONT));
    })();
    loading.catch(() => {
      if (ready === loading) ready = null;
    });
    ready = loading;
  }
  return ready;
}

export async function renderImage(svg: string): Promise<{ width: number; height: number; pixels: Uint8Array; png: Uint8Array }> {
  const font = await init();
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: [font], defaultFontFamily: 'Geist', loadSystemFonts: false } });
  const image = resvg.render();
  return { width: image.width, height: image.height, pixels: image.pixels, png: image.asPng() };
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  return (await renderImage(svg)).png;
}
```

If resvg-wasm 2.6.2's `index.d.ts` names an option differently (`fontBuffers`, `defaultFontFamily`, `loadSystemFonts`, `pixels`), follow the `.d.ts`. The text test is what proves the font loads.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @sponcam/mcp test raster` twice.
Expected: PASS both times. The first run writes `test/__snapshots__/raster.test.ts.snap`; the second run confirms the output is deterministic.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): PNG preview rasterising with resvg and the Geist font"
```

---

### Task 7: Session contract and the tool library file

**Files:**
- Create: `packages/mcp/src/session.ts`, `packages/mcp/src/library.ts`
- Modify: `packages/core/src/tools/library.ts`, `packages/web/src/state/toolLibrary.ts`
- Test: `packages/core/test/tools.test.ts` (add a `describe`), `packages/mcp/test/library.test.ts`

**Interfaces:**
- Produces (core):
  - `sortTools(tools: readonly Tool[]): Tool[]` (by T number, then name)
  - `parseToolLibraryFile(bytes: Uint8Array, fileName: string): FusionImportResult`
  - `interface ToolLibraryMerge { incoming: Tool[]; library: Tool[]; added: number; updated: number; notes: string[] }`
  - `mergeToolLibrary(existing: readonly Tool[], imported: readonly Tool[]): ToolLibraryMerge`
- Produces (mcp `src/session.ts`) — the complete file:

```ts
import type {
  BBox, CadBodySummary, CamRun, GeometryCatalog, Job, JobCommand, LengthUnit, ModelFormat, ModelKind, PreviewOptions, ProgramRef, Tool, Vec3,
} from '@sponcam/core';

/** A failure with a message meant for Claude; the tool layer turns it into an isError result. */
export class SessionError extends Error {
  override name = 'SessionError';
}

export interface SessionInfo {
  kind: 'file' | 'live';
  name: string;
  /** Absolute .spon path once opened or saved, else null. */
  path: string | null;
  dirty: boolean;
  model: { sourceName: string; kind: ModelKind; format: ModelFormat; body: number | null } | null;
  operations: number;
}

export interface ModelInput { fileName: string; bytes: Uint8Array; units?: LengthUnit; body?: number }

export type ImportOutcome =
  | { status: 'imported'; kind: ModelKind; size: Vec3; units: LengthUnit; warnings: string[] }
  /** STL/DXF that doesn't declare its units; `rawSize` is in file units. */
  | { status: 'needsUnits'; suggested: LengthUnit; rawSize: Vec3 }
  | { status: 'needsBody'; bodies: CadBodySummary[]; suggested: number }
  | { status: 'error'; error: string };

export type ExportOutcome =
  | { ok: true; files: { name: string; text: string }[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export interface LibraryImportResult { added: number; updated: number; skipped: { name: string; reason: string }[]; notes: string[] }

export interface ToolLibraryAccess {
  list(): Promise<Tool[]>;
  add(tool: Tool): Promise<void>;
  importFile(fileName: string, bytes: Uint8Array): Promise<LibraryImportResult>;
}

/** One open job: a .spon file on disk (FileSession) or, in phase 2, the browser tab. */
export interface JobSession {
  readonly kind: 'file' | 'live';
  readonly tools: ToolLibraryAccess;
  describe(): Promise<SessionInfo>;
  job(): Promise<Job>;
  /** Atomic: all commands apply or none do. */
  apply(commands: readonly JobCommand[], label?: string): Promise<Job>;
  importModel(input: ModelInput): Promise<ImportOutcome>;
  run(): Promise<CamRun>;
  catalog(): Promise<GeometryCatalog | null>;
  /** Placed model box and stock box in program coordinates. */
  boxes(): Promise<{ model: BBox | null; stock: BBox | null }>;
  previewSvg(options: PreviewOptions): Promise<string>;
  /** Returns the absolute path written. */
  save(path?: string): Promise<string>;
  exportGcode(): Promise<ExportOutcome>;
  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef>;
}
```

- Produces (mcp `src/library.ts`): `defaultLibraryPath(env?: NodeJS.ProcessEnv): string` and `class ToolLibraryFile implements ToolLibraryAccess { constructor(readonly path: string) }`.

- [ ] **Step 1: Write the failing core test** (append to `packages/core/test/tools.test.ts`; add `exportToolLibrary`, `mergeToolLibrary`, `parseToolLibraryFile`, `starterLibrary` and `type Tool` to its `../src` import where they're missing)

```ts
describe('mergeToolLibrary', () => {
  const t = (id: string, number: number, name = id): Tool => ({ ...starterLibrary()[0], id, number, name });

  it('replaces tools with the same id and keeps T numbers unique', () => {
    const merge = mergeToolLibrary([t('a', 1), t('b', 2)], [t('b', 5, 'B2'), t('c', 1)]);
    expect(merge.incoming.map((x) => [x.id, x.number])).toEqual([['b', 5], ['c', 2]]);
    expect(merge.notes).toEqual(['c: T1 was taken, renumbered to T2']);
    expect(merge.library.map((x) => [x.id, x.number])).toEqual([['a', 1], ['c', 2], ['b', 5]]);
    expect([merge.added, merge.updated]).toEqual([1, 1]);
  });

  it('reads a Spon library file', () => {
    const bytes = new TextEncoder().encode(exportToolLibrary([t('a', 1)]));
    expect(parseToolLibraryFile(bytes, 'lib.json')).toEqual({ tools: [t('a', 1)], skipped: [] });
  });
});
```

Run: `pnpm --filter @sponcam/core test tools`
Expected: FAIL (`mergeToolLibrary` is not exported).

- [ ] **Step 2: Implement in `packages/core/src/tools/library.ts`** (append)

```ts
/** Tools in library order: by T number, then by name. */
export function sortTools(tools: readonly Tool[]): Tool[] {
  return [...tools].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));
}

/** A Spon library (.json with "spon-tools") or a Fusion 360 library (.json / zipped .tools). */
export function parseToolLibraryFile(bytes: Uint8Array, fileName: string): FusionImportResult {
  const text = new TextDecoder().decode(bytes);
  const isSpon = !fileName.toLowerCase().endsWith('.tools') && text.includes('"spon-tools"');
  return isSpon ? { tools: importToolLibrary(text), skipped: [] } : importFusionLibrary(bytes, fileName);
}

export interface ToolLibraryMerge { incoming: Tool[]; library: Tool[]; added: number; updated: number; notes: string[] }

/** Imported tools replace library tools with the same id; a T number used by another library tool moves to the next free one. */
export function mergeToolLibrary(existing: readonly Tool[], imported: readonly Tool[]): ToolLibraryMerge {
  const existingIds = new Set(existing.map((t) => t.id));
  const importedIds = new Set(imported.map((t) => t.id));
  const taken = new Set(existing.filter((t) => !importedIds.has(t.id)).map((t) => t.number));
  const notes: string[] = [];
  const incoming = imported.map((t) => {
    let number = t.number;
    while (taken.has(number)) number++;
    taken.add(number);
    if (number === t.number) return t;
    notes.push(`${t.name}: T${t.number} was taken, renumbered to T${number}`);
    return { ...t, number };
  });
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  const updated = incoming.filter((t) => existingIds.has(t.id)).length;
  return { incoming, library: sortTools([...byId.values()]), added: incoming.length - updated, updated, notes };
}
```

- [ ] **Step 3: The web library uses the core functions**

In `packages/web/src/state/toolLibrary.ts`, replace the body of `importLibraryFile` with:

```ts
  const result = parseToolLibraryFile(new Uint8Array(await file.arrayBuffer()), file.name);
  const d = await db();
  const merge = mergeToolLibrary(await d.getAll('tools'), result.tools);
  const tx = d.transaction('tools', 'readwrite');
  for (const t of merge.incoming) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  return { added: merge.added, updated: merge.updated, skipped: result.skipped, notes: merge.notes };
```

Make `refresh()` store `sortTools(all)`. In the core import, add `mergeToolLibrary, parseToolLibraryFile, sortTools`, and drop `importFusionLibrary` and `importToolLibrary` if nothing else uses them.

Run: `pnpm --filter @sponcam/core test tools && pnpm --filter @sponcam/web test toolLibrary`
Expected: PASS. The existing web library tests are unchanged.

- [ ] **Step 4: Write `packages/mcp/src/session.ts`**

Use the complete file shown under **Interfaces** above.

- [ ] **Step 5: Write the failing library test**

`packages/mcp/test/library.test.ts`:

```ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportToolLibrary, importToolLibrary, starterLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultLibraryPath, ToolLibraryFile } from '../src/library';
import { tempDir, tool6 } from './helpers';

describe('ToolLibraryFile', () => {
  it('seeds a missing library with the starter tools', async () => {
    const path = join(tempDir(), 'nested', 'tools.json');
    const tools = await new ToolLibraryFile(path).list();
    expect(tools.map((t) => t.id).sort()).toEqual(starterLibrary().map((t) => t.id).sort());
    expect(importToolLibrary(readFileSync(path, 'utf8'))).toHaveLength(tools.length);
  });

  it('adds tools, refuses a taken T number and leaves no temporary files', async () => {
    const dir = tempDir();
    const lib = new ToolLibraryFile(join(dir, 'tools.json'));
    const taken = (await lib.list())[0];
    await expect(lib.add({ ...tool6, id: 'mine', number: taken.number })).rejects.toThrow(`T${taken.number} is already used by "${taken.name}"`);
    await lib.add({ ...tool6, id: 'mine', number: 99 });
    expect((await lib.list()).some((t) => t.id === 'mine')).toBe(true);
    expect(readdirSync(dir)).toEqual(['tools.json']);
  });

  it('imports a Spon library file', async () => {
    const lib = new ToolLibraryFile(join(tempDir(), 'tools.json'));
    const result = await lib.importFile('lib.json', new TextEncoder().encode(exportToolLibrary([{ ...tool6, id: 'x', number: 77 }])));
    expect(result).toEqual({ added: 1, updated: 0, skipped: [], notes: [] });
    expect((await lib.list()).find((t) => t.id === 'x')?.number).toBe(77);
  });

  it('names the file when the library is invalid', async () => {
    const path = join(tempDir(), 'tools.json');
    writeFileSync(path, '{ nope');
    await expect(new ToolLibraryFile(path).list()).rejects.toThrow(path);
  });

  it('defaults to ~/.spon/tools.json unless SPON_TOOL_LIBRARY is set', () => {
    expect(defaultLibraryPath({ SPON_TOOL_LIBRARY: '/x/y.json' })).toBe('/x/y.json');
    expect(defaultLibraryPath({}).replace(/\\/g, '/')).toMatch(/\/\.spon\/tools\.json$/);
  });
});
```

Run: `pnpm --filter @sponcam/mcp test library`
Expected: FAIL (cannot resolve `../src/library`).

- [ ] **Step 6: Implement `packages/mcp/src/library.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exportToolLibrary, importToolLibrary, mergeToolLibrary, parseToolLibraryFile, sortTools, starterLibrary, type Tool, validateTool } from '@sponcam/core';
import { type LibraryImportResult, SessionError, type ToolLibraryAccess } from './session';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function defaultLibraryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPON_TOOL_LIBRARY || join(homedir(), '.spon', 'tools.json');
}

/** The headless tool library: a Spon library JSON file (the web app's export format), seeded with the starter tools. */
export class ToolLibraryFile implements ToolLibraryAccess {
  constructor(readonly path: string) {}

  async list(): Promise<Tool[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new SessionError(`Could not read the tool library ${this.path}: ${message(err)}`);
      const seeded = sortTools(starterLibrary());
      await this.write(seeded);
      return seeded;
    }
    try {
      return sortTools(importToolLibrary(text));
    } catch (err) {
      throw new SessionError(`The tool library ${this.path} is not valid: ${message(err)}`);
    }
  }

  async add(tool: Tool): Promise<void> {
    if (!validateTool(tool)) throw new SessionError('The tool has invalid values');
    const tools = await this.list();
    const other = tools.find((t) => t.id !== tool.id && t.number === tool.number);
    if (other) throw new SessionError(`T${tool.number} is already used by "${other.name}"`);
    await this.write(sortTools([...tools.filter((t) => t.id !== tool.id), tool]));
  }

  async importFile(fileName: string, bytes: Uint8Array): Promise<LibraryImportResult> {
    const parsed = parseToolLibraryFile(bytes, fileName);
    const merge = mergeToolLibrary(await this.list(), parsed.tools);
    await this.write(merge.library);
    return { added: merge.added, updated: merge.updated, skipped: parsed.skipped, notes: merge.notes };
  }

  /** Writes a temporary file and renames it over the library, so a crash never leaves half a file. */
  private async write(tools: readonly Tool[]): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, exportToolLibrary(tools));
      await rename(tmp, this.path);
    } catch (err) {
      throw new SessionError(`Could not write the tool library ${this.path}: ${message(err)}`);
    }
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @sponcam/mcp test library && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core packages/web packages/mcp
git commit -m "feat(mcp): session contract and the tool library file; library merge moves to core"
```

---
### Task 8: `FileSession`

**Files:**
- Create: `packages/mcp/src/fileSession.ts`
- Test: `packages/mcp/test/fileSession.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1–3: `importModel`, `importStep`, `defaultBody`, `toModelGeometry`, `suggestedUnits`, `placementFor`, `programContext`, `runPipeline`, `PipelineCache`, `exportProblems`, `exportInputFromRun`;
  - Task 5: `previewInput`, `renderPreviewSvg`;
  - core: `camContext`, `readSpon`, `writeSpon`, `modelFilePath`, `setModel`, `addProgram`, `applyCommand`, `CommandError`, `createJob`, `applyMachinePreset`, `defaultPostSettings`, `bboxOfPoints`, `bboxSize`;
  - Task 7: `JobSession`, `SessionError`, `ToolLibraryAccess`, `ModelInput`, `ImportOutcome`, `ExportOutcome`, `SessionInfo`.
- Produces:
  - `interface FileSessionOptions { library: ToolLibraryAccess; loadReader: OcctLoader; postDate?: string }`
  - `interface NewJobOptions { name?: string; machinePreset?: MachinePresetName; dialect?: DialectId }`
  - `class FileSession implements JobSession`, with `static create(opts: NewJobOptions, options: FileSessionOptions): FileSession` and `static open(path: string, options: FileSessionOptions): Promise<FileSession>` (the path must be absolute; the tool layer resolves relative paths).

Behaviour (binding):
- A new job starts **clean** (`dirty: false`) with no path, because there is nothing to lose. This refines spec §3.1, which said a new job starts dirty; a clean start means an untouched new job never blocks `new_job`/`open_job`. Any change makes the job dirty: `apply` when it changes the job, `importModel`, or `importProgram`. `save` makes it clean.
- `apply` folds the commands. Any error becomes a `CommandError` whose message is `commands[<i>] <type>: <message>`, and the job is left unchanged.
- `importModel` uses `input.units` only when the file doesn't declare its own units (`step.units ?? input.units`).
- `save` adds `.spon` when the path lacks it.

- [ ] **Step 1: Write the failing tests**

`packages/mcp/test/fileSession.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GeometryRef, JobCommand } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { FileSession, type FileSessionOptions } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { loadNodeOcct } from '../src/occt';
import { fixture, tempDir, tool6 } from './helpers';

const options = (): FileSessionOptions => ({ library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });

async function profiledDxf() {
  const s = FileSession.create({ name: 'Part' }, options());
  expect((await s.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') })).status).toBe('imported');
  const outline = (await s.catalog())!.contours.find((c) => c.layer === 'OUTLINE')!.ref as GeometryRef;
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [outline] } },
  ];
  await s.apply(commands);
  return s;
}

describe('FileSession', () => {
  it('starts clean and needs a path for the first save', async () => {
    const s = FileSession.create({ name: 'New', dialect: 'fanuc', machinePreset: 'Generic VMC' }, options());
    expect(await s.describe()).toEqual({ kind: 'file', name: 'New', path: null, dirty: false, model: null, operations: 0 });
    expect((await s.job()).post.dialect).toBe('fanuc');
    expect((await s.job()).machine.name).toBe('Generic VMC');
    await expect(s.save()).rejects.toThrow('This job has not been saved yet — give a path');
  });

  it('imports, edits, generates, saves and reopens to the same job and G-code (review focus 2)', async () => {
    const s = await profiledDxf();
    const run = await s.run();
    expect(run.results[0].hasToolpath).toBe(true);
    const dir = tempDir();
    const path = await s.save(join(dir, 'part'));
    expect(path).toBe(join(dir, 'part.spon'));
    expect((await s.describe()).dirty).toBe(false);
    const reopened = await FileSession.open(path, options());
    expect(await reopened.job()).toEqual(await s.job());
    expect((await reopened.run()).files.map((f) => f.text)).toEqual(run.files.map((f) => f.text));
    expect((await reopened.describe()).path).toBe(path);
  });

  it('asks for a body, then reopens a STEP job through the Node reader (review focus 2)', async () => {
    const s = FileSession.create({}, options());
    const ask = await s.importModel({ fileName: 'two-bodies.step', bytes: fixture('two-bodies.step') });
    if (ask.status !== 'needsBody') throw new Error(`expected needsBody, got ${ask.status}`);
    expect(ask.bodies).toHaveLength(2);
    expect(ask.suggested).toBe(1);
    expect((await s.importModel({ fileName: 'two-bodies.step', bytes: fixture('two-bodies.step'), body: 1 })).status).toBe('imported');
    const path = await s.save(join(tempDir(), 'two.spon'));
    const reopened = await FileSession.open(path, options());
    expect((await reopened.describe()).model).toEqual({ sourceName: 'two-bodies.step', kind: 'mesh', format: 'step', body: 1 });
    expect((await reopened.catalog())!.faces.map((f) => f.ref)).toEqual((await s.catalog())!.faces.map((f) => f.ref));
  });

  it('asks for units when the file has none', async () => {
    const s = FileSession.create({}, options());
    const ask = await s.importModel({ fileName: 'plate-pocket.stl', bytes: fixture('plate-pocket.stl') });
    if (ask.status !== 'needsUnits') throw new Error(`expected needsUnits, got ${ask.status}`);
    expect(['mm', 'in']).toContain(ask.suggested);
    expect(ask.rawSize.x).toBeGreaterThan(0);
    const done = await s.importModel({ fileName: 'plate-pocket.stl', bytes: fixture('plate-pocket.stl'), units: 'mm' });
    if (done.status !== 'imported') throw new Error('expected imported');
    expect(done.size.x).toBeCloseTo(ask.rawSize.x, 3);
    expect((await s.describe()).dirty).toBe(true);
  });

  it('applies a batch atomically', async () => {
    const s = await profiledDxf();
    const before = await s.job();
    await expect(s.apply([
      { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' },
      { type: 'updateOperation', id: 'nope', patch: { name: 'x' } },
    ])).rejects.toThrow('commands[1] updateOperation: No operation with id nope');
    expect(await s.job()).toBe(before);
  });

  it('warns when a new model replaces the one operations refer to', async () => {
    const s = await profiledDxf();
    const again = await s.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') });
    if (again.status !== 'imported') throw new Error('expected imported');
    expect(again.warnings).toContain('1 operation(s) referred to the previous model; their geometry no longer resolves');
    expect((await s.run()).results[0].diagnostics[0].severity).toBe('error');
  });

  it('exports posted files and refuses while there are errors', async () => {
    const s = await profiledDxf();
    const ok = await s.exportGcode();
    if (!ok.ok) throw new Error(ok.errors.join('; '));
    expect(ok.files[0].name).toMatch(/\.nc$/);
    await s.apply([{ type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'empty' }]);
    const blocked = await s.exportGcode();
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.errors.some((e) => e.includes('Pick geometry'))).toBe(true);
  });

  it('adds G-code programs that survive saving', async () => {
    const s = FileSession.create({}, options());
    const program = await s.importProgram('drill-arc.nc', fixture('drill-arc.nc'));
    expect(program).toMatchObject({ name: 'drill-arc.nc', source: 'imported', inTimeline: true });
    const reopened = await FileSession.open(await s.save(join(tempDir(), 'p.spon')), options());
    expect((await reopened.job()).programs).toEqual([program]);
  });

  it('names the file when opening fails', async () => {
    const missing = join(tempDir(), 'missing.spon');
    await expect(FileSession.open(missing, options())).rejects.toThrow(`Could not read ${missing}`);
    expect(existsSync(missing)).toBe(false);
  });

  it('describes the model and stock boxes and renders a preview', async () => {
    const s = await profiledDxf();
    const { model, stock } = await s.boxes();
    expect(stock!.max.x - stock!.min.x).toBeGreaterThan(model!.max.x - model!.min.x);
    expect(await s.previewSvg({ view: 'iso' })).toContain('<g id="op-0"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test fileSession`
Expected: FAIL (cannot resolve `../src/fileSession`).

- [ ] **Step 3: Implement `packages/mcp/src/fileSession.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  addProgram, applyCommand, applyMachinePreset, type BBox, bboxOfPoints, bboxSize, type BlobMap, camContext, type CamRun, CommandError, createJob,
  defaultBody, defaultPostSettings, type DialectId, exportInputFromRun, exportProblems, type GeometryCatalog, importModel, importStep, type Job,
  type JobCommand, type MachinePresetName, type ModelGeometry, modelFilePath, type OcctLoader, PipelineCache, type PipelineResult, placementFor,
  type PreviewOptions, previewInput, type ProgramRef, programContext, readSpon, renderPreviewSvg, runPipeline, setModel, SPON_EXTENSION,
  suggestedUnits, toModelGeometry, vec3, writeSpon,
} from '@sponcam/core';
import {
  type ExportOutcome, type ImportOutcome, type JobSession, type ModelInput, SessionError, type SessionInfo, type ToolLibraryAccess,
} from './session';

export interface FileSessionOptions { library: ToolLibraryAccess; loadReader: OcctLoader; postDate?: string }
export interface NewJobOptions { name?: string; machinePreset?: MachinePresetName; dialect?: DialectId }

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A job held in memory, loaded from and saved to a .spon file. There is no undo: reopen, or issue new commands. */
export class FileSession implements JobSession {
  readonly kind = 'file' as const;
  readonly tools: ToolLibraryAccess;
  private readonly cache = new PipelineCache();
  private last: { job: Job; geometry: ModelGeometry | null; result: PipelineResult } | null = null;

  private constructor(
    private current: Job,
    private blobs: BlobMap,
    private geometry: ModelGeometry | null,
    private path: string | null,
    private dirty: boolean,
    private readonly options: FileSessionOptions,
  ) {
    this.tools = options.library;
  }

  static create(opts: NewJobOptions, options: FileSessionOptions): FileSession {
    let job = createJob(opts.name ?? 'Untitled');
    if (opts.machinePreset) job = applyMachinePreset(job, opts.machinePreset);
    if (opts.dialect) job = { ...job, post: defaultPostSettings(opts.dialect) };
    return new FileSession(job, {}, null, null, false, options);
  }

  /** Opens a .spon file (absolute path) and re-reads its model exactly as the web app does. */
  static async open(path: string, options: FileSessionOptions): Promise<FileSession> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (err) {
      throw new SessionError(`Could not read ${path}: ${message(err)}`);
    }
    let job: Job;
    let blobs: BlobMap;
    try {
      ({ job, blobs } = readSpon(bytes));
    } catch (err) {
      throw new SessionError(`${path}: ${message(err)}`);
    }
    let geometry: ModelGeometry | null = null;
    if (job.model) {
      const step = importStep(await importModel(modelFilePath(job.model), blobs[job.model.blobId], job.model.body, options.loadReader));
      if (step.kind === 'error') throw new SessionError(`Could not load the job's model: ${step.error}`);
      if (step.kind === 'chooseBody') throw new SessionError("Could not load the job's model: the file has several bodies and the job does not say which one");
      geometry = toModelGeometry(step.result);
    }
    return new FileSession(job, blobs, geometry, path, false, options);
  }

  async describe(): Promise<SessionInfo> {
    const m = this.current.model;
    return {
      kind: 'file', name: this.current.name, path: this.path, dirty: this.dirty,
      model: m ? { sourceName: m.sourceName, kind: m.kind, format: m.format ?? (m.kind === 'mesh' ? 'stl' : 'dxf'), body: m.body ?? null } : null,
      operations: this.current.operations.length,
    };
  }

  async job(): Promise<Job> {
    return this.current;
  }

  async apply(commands: readonly JobCommand[]): Promise<Job> {
    let next = this.current;
    commands.forEach((c, i) => {
      try {
        next = applyCommand(next, c);
      } catch (err) {
        throw new CommandError(`commands[${i}] ${c.type}: ${message(err)}`);
      }
    });
    if (next !== this.current) {
      this.current = next;
      this.dirty = true;
    }
    return this.current;
  }

  async importModel(input: ModelInput): Promise<ImportOutcome> {
    const step = importStep(await importModel(input.fileName, input.bytes, input.body, this.options.loadReader));
    if (step.kind === 'error') return { status: 'error', error: step.error };
    if (step.kind === 'chooseBody') return { status: 'needsBody', bodies: step.bodies, suggested: defaultBody(step.bodies) };
    const geometry = toModelGeometry(step.result);
    const units = step.units ?? input.units;
    if (!units) {
      const raw = bboxOfPoints(geometry.rawPoints);
      return { status: 'needsUnits', suggested: suggestedUnits(step.result), rawSize: raw ? bboxSize(raw) : vec3(0, 0, 0) };
    }
    const affected = this.current.operations.filter((op) => op.geometry.length > 0).length;
    const blobId = crypto.randomUUID();
    const source = geometry.kind === 'mesh' ? geometry.source : undefined;
    const oldBlob = this.current.model?.blobId;
    this.current = setModel(this.current, {
      sourceName: input.fileName, blobId, kind: geometry.kind, importUnits: units, ...(source ? { format: source.format, body: source.body } : {}),
    });
    this.blobs = { ...Object.fromEntries(Object.entries(this.blobs).filter(([id]) => id !== oldBlob)), [blobId]: input.bytes };
    this.geometry = geometry;
    this.dirty = true;
    const placement = placementFor(this.current.model!, geometry);
    const warnings = [...step.result.warnings];
    if (affected) warnings.push(`${affected} operation(s) referred to the previous model; their geometry no longer resolves`);
    return { status: 'imported', kind: geometry.kind, size: placement ? bboxSize(placement.bbox) : vec3(0, 0, 0), units, warnings };
  }

  private pipeline(): PipelineResult {
    if (this.last && this.last.job === this.current && this.last.geometry === this.geometry) return this.last.result;
    const opts = this.options.postDate ? { date: this.options.postDate } : {};
    const result = runPipeline(this.current, this.geometry, programContext(this.current, this.geometry), this.cache, opts);
    this.last = { job: this.current, geometry: this.geometry, result };
    return result;
  }

  async run(): Promise<CamRun> {
    return this.pipeline().run;
  }

  async catalog(): Promise<GeometryCatalog | null> {
    return this.cache.catalogFor(this.current, this.geometry);
  }

  async boxes(): Promise<{ model: BBox | null; stock: BBox | null }> {
    const ctx = camContext(this.current, this.geometry);
    return { model: ctx.model, stock: ctx.stock };
  }

  async previewSvg(options: PreviewOptions): Promise<string> {
    return renderPreviewSvg(previewInput(this.current, this.geometry, this.pipeline()), options);
  }

  async save(path?: string): Promise<string> {
    const target = path ?? this.path;
    if (!target) throw new SessionError('This job has not been saved yet — give a path');
    const file = extname(target).toLowerCase() === SPON_EXTENSION ? target : `${target}${SPON_EXTENSION}`;
    try {
      await writeFile(file, writeSpon(this.current, this.blobs));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    this.path = file;
    this.dirty = false;
    return file;
  }

  async exportGcode(): Promise<ExportOutcome> {
    const run = this.pipeline().run;
    const { errors, warnings } = exportProblems(exportInputFromRun(this.current, run));
    if (errors.length) return { ok: false, errors, warnings };
    return { ok: true, files: run.files.map((f) => ({ name: f.name, text: f.text })), warnings };
  }

  async importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef> {
    const blobId = crypto.randomUUID();
    this.blobs = { ...this.blobs, [blobId]: bytes };
    this.current = addProgram(this.current, { name: fileName, blobId });
    this.dirty = true;
    return this.current.programs.at(-1)!;
  }
}
```

Notes for the implementer:
- `bboxOfPoints` takes `ArrayLike<number>` and returns `BBox | null`.
- `CommandError` is a class, so import it as a value.
- If `ModelRef.format` has no `'dxf'` member, the expression `m.format ?? (m.kind === 'mesh' ? 'stl' : 'dxf')` still types as `ModelFormat`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/mcp test fileSession && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): FileSession — jobs on disk with import, commands, pipeline, preview, save and export"
```

---

### Task 9: Geometry handles

**Files:**
- Create: `packages/mcp/src/handles.ts`
- Test: `packages/mcp/test/handles.test.ts`

**Interfaces:**
- Consumes: `GeometryCatalog`, `GeometryRef` (core); `SessionError` (Task 7).
- Produces:
  - `type HandledLoop = CatalogFace['loops'][number] & { handle: string }`
  - `type HandledFace = Omit<CatalogFace, 'loops'> & { handle: string; loops: HandledLoop[] }`
  - `type HandledHole = CatalogHole & { handle: string }`
  - `type HandledContour = CatalogContour & { handle: string }`
  - `interface HandledCatalog { faces: HandledFace[]; holes: HandledHole[]; contours: HandledContour[] }`
  - `class HandleMap { assign(catalog: GeometryCatalog): HandledCatalog; resolve(item: string | GeometryRef): GeometryRef; clear(): void; get size(): number }`
  - `catalogText(catalog: HandledCatalog): string`

Handles, in catalog order:
- `F1`, `F2`, … faces;
- `F<n>.L<index>` face loops, which resolve to `{ kind: 'meshLoop', face: <face ref>, loop: <index> }`;
- `H1`, … holes;
- `C1`, … contours.

Handles are matched case-insensitively, and `assign` replaces the whole map.

- [ ] **Step 1: Write the failing test**

`packages/mcp/test/handles.test.ts`:

```ts
import { createJob, describeGeometry, type GeometryRef, importFile, setModel, setStock, toModelGeometry } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { catalogText, HandleMap } from '../src/handles';
import { fixture } from './helpers';

function plateCatalog() {
  const r = importFile('plate-pocket.stl', fixture('plate-pocket.stl'));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const job = setStock(setModel(createJob(), { sourceName: 'plate-pocket.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return describeGeometry(job, toModelGeometry(r));
}

describe('HandleMap', () => {
  it('names faces, loops and holes and resolves them to refs', () => {
    const catalog = plateCatalog();
    const map = new HandleMap();
    const handled = map.assign(catalog);
    expect(handled.faces[0].handle).toBe('F1');
    expect(handled.faces[0].loops[0].handle).toBe('F1.L0');
    expect(handled.holes[0].handle).toBe('H1');
    expect(map.resolve('F1')).toEqual(catalog.faces[0].ref);
    expect(map.resolve(' f1.l0 ')).toEqual({ kind: 'meshLoop', face: catalog.faces[0].ref, loop: catalog.faces[0].loops[0].index });
    expect(map.resolve('h1')).toEqual(catalog.holes[0].ref);
  });

  it('passes full refs through and rejects unknown handles', () => {
    const map = new HandleMap();
    const ref: GeometryRef = { kind: 'dxfPath', blobId: 'd', layer: 0, path: 1 };
    expect(map.resolve(ref)).toBe(ref);
    expect(() => map.resolve('F9')).toThrow('Unknown handle F9 — call describe_geometry for the current list');
  });

  it('forgets old handles on assign and clear', () => {
    const map = new HandleMap();
    map.assign(plateCatalog());
    expect(map.size).toBeGreaterThan(0);
    map.assign({ faces: [], holes: [], contours: [] });
    expect(() => map.resolve('F1')).toThrow('Unknown handle F1');
    map.assign(plateCatalog());
    map.clear();
    expect(map.size).toBe(0);
  });

  it('describes the catalog as text', () => {
    const text = catalogText(new HandleMap().assign(plateCatalog()));
    expect(text).toMatch(/^F1 /m);
    expect(text).toContain('F1.L0 outer');
    expect(text).toMatch(/^H1 ⌀/m);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test handles`
Expected: FAIL (cannot resolve `../src/handles`).

- [ ] **Step 3: Implement `packages/mcp/src/handles.ts`**

```ts
import type { CatalogContour, CatalogFace, CatalogHole, GeometryCatalog, GeometryRef } from '@sponcam/core';
import { SessionError } from './session';

export type HandledLoop = CatalogFace['loops'][number] & { handle: string };
export type HandledFace = Omit<CatalogFace, 'loops'> & { handle: string; loops: HandledLoop[] };
export type HandledHole = CatalogHole & { handle: string };
export type HandledContour = CatalogContour & { handle: string };
export interface HandledCatalog { faces: HandledFace[]; holes: HandledHole[]; contours: HandledContour[] }

/** Short names (F1, F1.L0, H1, C1) for the latest describe_geometry catalog. Refs are raw-model based, so they survive reorienting. */
export class HandleMap {
  private refs = new Map<string, GeometryRef>();

  assign(catalog: GeometryCatalog): HandledCatalog {
    this.refs.clear();
    const name = <T>(handle: string, ref: GeometryRef, item: T): T & { handle: string } => {
      this.refs.set(handle, ref);
      return { ...item, handle };
    };
    const faces = catalog.faces.map((f, i) => {
      const handle = `F${i + 1}`;
      this.refs.set(handle, f.ref);
      const loops = f.loops.map((l) => name(`${handle}.L${l.index}`, { kind: 'meshLoop', face: f.ref, loop: l.index }, l));
      return { ...f, handle, loops };
    });
    const holes = catalog.holes.map((h, i) => name(`H${i + 1}`, h.ref, h));
    const contours = catalog.contours.map((c, i) => name(`C${i + 1}`, c.ref, c));
    return { faces, holes, contours };
  }

  resolve(item: string | GeometryRef): GeometryRef {
    if (typeof item !== 'string') return item;
    const ref = this.refs.get(item.trim().toUpperCase());
    if (!ref) throw new SessionError(`Unknown handle ${item.trim()} — call describe_geometry for the current list`);
    return ref;
  }

  clear(): void {
    this.refs.clear();
  }

  get size(): number {
    return this.refs.size;
  }
}

const mm = (v: number) => v.toFixed(3);
const at = (c: { x: number; y: number }) => `(${mm(c.x)}, ${mm(c.y)})`;

/** One line per face, hole and contour, in program coordinates (mm). */
export function catalogText(c: HandledCatalog): string {
  const lines: string[] = [];
  for (const f of c.faces) {
    const loops = f.loops.map((l) => `${l.handle} ${l.kind}${l.circle ? ` ⌀${mm(l.circle.diameter)} at ${at(l.circle.center)}` : ` length ${l.length.toFixed(1)}`}`);
    lines.push(`${f.handle} face z ${mm(f.z)}, area ${f.area.toFixed(1)} mm²; loops: ${loops.join(', ')}`);
  }
  for (const h of c.holes) lines.push(`${h.handle} ⌀${mm(h.diameter)} at ${at(h.center)}, z ${mm(h.bottom)} to ${mm(h.top)}, ${h.through ? 'through' : 'blind'}`);
  for (const k of c.contours) {
    const shape = k.circle ? `circle ⌀${mm(k.circle.diameter)} at ${at(k.circle.center)}` : `box ${at(k.bbox.min)} to ${at(k.bbox.max)}`;
    lines.push(`${k.handle} contour on layer ${k.layer}, ${k.closed ? 'closed' : 'open'}, length ${k.length.toFixed(1)}, ${shape}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @sponcam/mcp test handles && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS. If the plate fixture has no holes in the catalog, stop and check `plate-pocket.stl` in `describeGeometry`'s core test. The Milestone 3 spec says it has holes.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): short geometry handles for the catalog"
```

---

### Task 10: zod schemas for commands, tools and geometry refs

**Files:**
- Create: `packages/mcp/src/schemas.ts`
- Test: `packages/mcp/test/schemas.test.ts`

**Interfaces:**
- Produces:
  - `vec3Schema`, `lengthUnitSchema`, `operationTypeSchema`, `dialectSchema`, `machinePresetSchema`;
  - `geometryRefSchema` (inferred type ≡ `GeometryRef`);
  - `operationPatchSchema` (≡ `OperationPatch`; strict, so unknown keys are rejected);
  - `toolSchema` (≡ `Tool`);
  - `jobCommandSchema` (≡ `JobCommand`).

"≡" means the two types are assignable to each other, which the test checks at compile time (`pnpm typecheck` covers `test/`).

- [ ] **Step 1: Write the failing test**

`packages/mcp/test/schemas.test.ts`:

```ts
import type { GeometryRef, JobCommand, OperationPatch, Tool } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { geometryRefSchema, jobCommandSchema, operationPatchSchema, toolSchema } from '../src/schemas';
import { tool6 } from './helpers';

// compile-time: each schema's type and the core type are assignable both ways
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <T extends true>(): T | undefined => undefined;
same<Same<z.infer<typeof jobCommandSchema>, JobCommand>>();
same<Same<z.infer<typeof operationPatchSchema>, OperationPatch>>();
same<Same<z.infer<typeof toolSchema>, Tool>>();
same<Same<z.infer<typeof geometryRefSchema>, GeometryRef>>();

const face = { kind: 'meshFace' as const, blobId: 'm', seed: 3, normal: { x: 0, y: 0, z: 1 }, point: { x: 1, y: 2, z: 3 } };
const SAMPLES: JobCommand[] = [
  { type: 'renameJob', name: 'Part' },
  { type: 'setDisplayUnits', unit: 'in' },
  { type: 'setImportUnits', unit: 'mm' },
  { type: 'rotateQuarter', axis: 'x', direction: -1 },
  { type: 'layFlat', rawNormal: { x: 0, y: 1, z: 0 } },
  { type: 'setZSpin', degrees: 90 },
  { type: 'resetOrientation' },
  { type: 'setStock', stock: { mode: 'fixed', size: { x: 100, y: 50, z: 10 }, modelOffset: { x: 5, y: 5, z: 0 } } },
  { type: 'setWcs', patch: { anchor: { x: 'min', y: 'center', z: 'top' }, workOffset: 'G55' } },
  { type: 'setMachineProfile', patch: { rapid: { x: 5000 }, maxFeed: 3000 } },
  { type: 'applyMachinePreset', name: 'Generic VMC' },
  { type: 'moveProgram', id: 'p', delta: 1 },
  { type: 'setProgramInTimeline', id: 'p', inTimeline: false },
  { type: 'removeProgram', id: 'p' },
  { type: 'addOperation', opType: 'pocket', toolId: null, id: 'o', name: 'Pocket A' },
  {
    type: 'updateOperation', id: 'o',
    patch: {
      geometry: [face, { kind: 'meshLoop', face, loop: 1 }], heights: { bottom: { from: 'face', offset: -0.5, face } }, stepoverPct: 40,
      tabs: { enabled: true, positions: [{ refIndex: 0, t: 0.25 }] }, leads: { startPoint: 'auto' }, diameterFilter: null,
    },
  },
  { type: 'removeOperation', id: 'o' },
  { type: 'duplicateOperation', id: 'o', newId: 'o2' },
  { type: 'moveOperation', id: 'o', delta: -1 },
  { type: 'setOperationEnabled', id: 'o', enabled: false },
  { type: 'addTool', tool: tool6 },
  { type: 'updateTool', id: 't6', patch: { number: 4, presets: [] } },
  { type: 'removeTool', id: 't6' },
  { type: 'setPost', patch: { dialect: 'linuxcnc', arcFormat: 'r', lineNumbers: true } },
  { type: 'setTolerance', tolerance: 0.01 },
];

describe('jobCommandSchema', () => {
  it('covers every command type', () => {
    expect(new Set(SAMPLES.map((c) => c.type)).size).toBe(25);
  });

  it('accepts every command unchanged', () => {
    for (const c of SAMPLES) expect(jobCommandSchema.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it('rejects unknown commands and unknown operation parameters', () => {
    expect(jobCommandSchema.safeParse({ type: 'explode' }).success).toBe(false);
    const bad = jobCommandSchema.safeParse({ type: 'updateOperation', id: 'o', patch: { stepovr: 40 } });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('stepovr');
  });
});
```

(Keep the count of 25 in sync with `JobCommand`. If core has gained a command type, add a sample and the schema entry for it.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test schemas`
Expected: FAIL (cannot resolve `../src/schemas`).

- [ ] **Step 3: Implement `packages/mcp/src/schemas.ts`**

```ts
import { z } from 'zod';

export const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const vec3Partial = vec3Schema.partial();
export const lengthUnitSchema = z.enum(['mm', 'in']);
export const operationTypeSchema = z.enum(['profile', 'pocket', 'drill']);
export const dialectSchema = z.enum(['grbl', 'linuxcnc', 'fanuc']);
export const machinePresetSchema = z.enum(['Hobby GRBL router', 'Generic VMC']);
const delta = z.union([z.literal(-1), z.literal(1)]);

const meshFaceRef = z.object({ kind: z.literal('meshFace'), blobId: z.string(), seed: z.number().int(), normal: vec3Schema, point: vec3Schema });
export const geometryRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dxfPath'), blobId: z.string(), layer: z.number().int(), path: z.number().int() }),
  meshFaceRef,
  z.object({ kind: z.literal('meshLoop'), face: meshFaceRef, loop: z.number().int() }),
  z.object({ kind: z.literal('meshHole'), face: meshFaceRef, loop: z.number().int() }),
]);

const heightFrom = z.enum(['stockTop', 'stockBottom', 'modelTop', 'modelBottom', 'contour', 'face', 'origin', 'holeBottom', 'retract', 'feed', 'top']);
const heightSpec = z.object({ from: heightFrom, offset: z.number(), face: meshFaceRef.optional() });
const coolant = z.enum(['off', 'flood', 'mist']);
const lapPosition = z.object({ refIndex: z.number().int(), t: z.number() });

export const operationPatchSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  toolId: z.string().nullable(),
  feeds: z.object({ presetName: z.string().nullable(), rpm: z.number(), feed: z.number(), plungeFeed: z.number(), coolant }).partial(),
  heights: z.object({ clearance: heightSpec, retract: heightSpec, feed: heightSpec, top: heightSpec, bottom: heightSpec }).partial(),
  geometry: z.array(geometryRefSchema),
  side: z.enum(['outside', 'inside', 'on']),
  direction: z.enum(['climb', 'conventional']),
  stepdown: z.number(),
  stockRadial: z.number(),
  stockAxial: z.number(),
  finishPass: z.boolean(),
  entry: z.object({ mode: z.enum(['auto', 'helix', 'ramp', 'plunge']), helixDiameterPct: z.number(), rampAngleDeg: z.number() }).partial(),
  leads: z.object({ mode: z.enum(['none', 'arc', 'line']), length: z.number(), startPoint: z.union([z.literal('auto'), lapPosition]) }).partial(),
  tabs: z.object({
    enabled: z.boolean(), shape: z.enum(['rect', 'triangle']), width: z.number(), height: z.number(), placement: z.enum(['count', 'spacing']),
    count: z.number(), spacing: z.number(), positions: z.array(lapPosition).nullable(),
  }).partial(),
  stepoverPct: z.number(),
  finishWalls: z.boolean(),
  finishFloor: z.boolean(),
  cycle: z.enum(['drill', 'dwell', 'peck', 'chipbreak']),
  peck: z.number(),
  dwellSeconds: z.number(),
  diameterFilter: z.object({ min: z.number(), max: z.number() }).nullable(),
}).partial().strict();

const presetSchema = z.object({
  name: z.string(), rpm: z.number(), feed: z.number(), plungeFeed: z.number(), stepdown: z.number(), stepoverPct: z.number(), coolant,
});
export const toolSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer']),
  number: z.number().int(),
  diameter: z.number(),
  cornerRadius: z.number(),
  tipAngleDeg: z.number(),
  fluteLength: z.number(),
  stickout: z.number(),
  flutes: z.number().int(),
  presets: z.array(presetSchema),
  vendor: z.string().optional(),
  productId: z.string().optional(),
});

const stockSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto'), margin: z.object({ xy: z.number(), zTop: z.number(), zBottom: z.number() }) }),
  z.object({ mode: z.literal('fixed'), size: vec3Schema, modelOffset: vec3Schema }),
]);
const wcsPatch = z.object({
  anchor: z.object({ x: z.enum(['min', 'center', 'max']), y: z.enum(['min', 'center', 'max']), z: z.enum(['top', 'bottom']) }),
  offset: vec3Schema,
  workOffset: z.enum(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']),
}).partial();
const machinePatch = z.object({ rapid: vec3Partial, accel: vec3Partial, maxFeed: z.number(), toolChangeSeconds: z.number() }).partial();
const postPatch = z.object({
  dialect: dialectSchema, splitByTool: z.boolean(), decimals: z.number().int(), arcFormat: z.enum(['ij', 'r']), lineNumbers: z.boolean(),
  lineNumberStep: z.number().int(), coolant: z.boolean(), spindleDwell: z.number(), safeStart: z.string(), programNumber: z.number().int(),
  extension: z.enum(['nc', 'gcode', 'tap']),
}).partial();

export const jobCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('renameJob'), name: z.string() }),
  z.object({ type: z.literal('setDisplayUnits'), unit: lengthUnitSchema }),
  z.object({ type: z.literal('setImportUnits'), unit: lengthUnitSchema }),
  z.object({ type: z.literal('rotateQuarter'), axis: z.enum(['x', 'y']), direction: delta }),
  z.object({ type: z.literal('layFlat'), rawNormal: vec3Schema }),
  z.object({ type: z.literal('setZSpin'), degrees: z.number() }),
  z.object({ type: z.literal('resetOrientation') }),
  z.object({ type: z.literal('setStock'), stock: stockSchema }),
  z.object({ type: z.literal('setWcs'), patch: wcsPatch }),
  z.object({ type: z.literal('setMachineProfile'), patch: machinePatch }),
  z.object({ type: z.literal('applyMachinePreset'), name: machinePresetSchema }),
  z.object({ type: z.literal('moveProgram'), id: z.string(), delta }),
  z.object({ type: z.literal('setProgramInTimeline'), id: z.string(), inTimeline: z.boolean() }),
  z.object({ type: z.literal('removeProgram'), id: z.string() }),
  z.object({ type: z.literal('addOperation'), opType: operationTypeSchema, toolId: z.string().nullable(), id: z.string().optional(), name: z.string().optional() }),
  z.object({ type: z.literal('updateOperation'), id: z.string(), patch: operationPatchSchema }),
  z.object({ type: z.literal('removeOperation'), id: z.string() }),
  z.object({ type: z.literal('duplicateOperation'), id: z.string(), newId: z.string().optional() }),
  z.object({ type: z.literal('moveOperation'), id: z.string(), delta }),
  z.object({ type: z.literal('setOperationEnabled'), id: z.string(), enabled: z.boolean() }),
  z.object({ type: z.literal('addTool'), tool: toolSchema }),
  z.object({ type: z.literal('updateTool'), id: z.string(), patch: toolSchema.omit({ id: true }).partial() }),
  z.object({ type: z.literal('removeTool'), id: z.string() }),
  z.object({ type: z.literal('setPost'), patch: postPatch }),
  z.object({ type: z.literal('setTolerance'), tolerance: z.number() }),
]);
```

Notes for the implementer:
- If a `Same<…>` check fails to compile, read the core type the error names and make the schema match it. Never change core types to fit the schema.
- `MachinePatch.rapid` is `Partial<AxisValues>`, where `AxisValues` has x/y/z, so `vec3Partial` fits it.

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @sponcam/mcp test schemas && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS. The typecheck is the real schema/type equality check.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): zod schemas for job commands, tools and geometry refs"
```

---
### Task 11: MCP server core and the session tools

**Files:**
- Create: `packages/mcp/src/context.ts`, `packages/mcp/src/state.ts`, `packages/mcp/src/instructions.ts`, `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/tools/result.ts`, `packages/mcp/src/tools/session.ts`
- Create: `packages/mcp/test/connect.ts`
- Test: `packages/mcp/test/tools-session.test.ts`

**Interfaces:**
- Consumes: `FileSession` (Task 8), `HandleMap` (Task 9), schemas (Task 10), `SessionError` and the outcome types (Task 7).
- Produces:
  - `interface ServerDeps { cwd: string; library: ToolLibraryAccess; loadReader: OcctLoader; rasterize(svg: string): Promise<Uint8Array>; postDate?: string }`
  - `interface ToolContext { deps; state: ServerState; resolvePath(path): string; readInput(path): Promise<{ path: string; bytes: Uint8Array }>; sessionOptions(): FileSessionOptions; library(): ToolLibraryAccess }`
  - `createContext(deps: ServerDeps): ToolContext`
  - `class ServerState { session: JobSession | null; readonly handles: HandleMap; requireSession(): JobSession; ensureCanSwitch(discard?: boolean): Promise<void>; use(session: JobSession): void }`, `NO_JOB`
  - `type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>`, `ok(text, data?)`, `failure(err)`, `guarded(name, body)`, `message(err)`
  - `createSponServer(deps: ServerDeps): McpServer`
  - `INSTRUCTIONS: string`
  - Test helpers: `connect(overrides?, files?)`, `text(result)`, `data(result)`.

- [ ] **Step 1: Write the test helper and the failing test**

`packages/mcp/test/connect.ts`:

```ts
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolLibraryFile } from '../src/library';
import { loadNodeOcct } from '../src/occt';
import { createSponServer, type ServerDeps } from '../src/server';
import { fixturePath, tempDir } from './helpers';

/** A server and client joined in memory, working in a fresh temporary directory holding copies of `files`. */
export async function connect(overrides: Partial<ServerDeps> = {}, files: string[] = []) {
  const dir = tempDir();
  for (const f of files) copyFileSync(fixturePath(f), join(dir, f));
  const deps: ServerDeps = {
    cwd: dir, library: new ToolLibraryFile(join(dir, 'tools.json')), loadReader: loadNodeOcct,
    rasterize: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), postDate: '2026-01-01', ...overrides,
  };
  const server = createSponServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spon-test', version: '0.0.0' });
  await client.connect(clientTransport);
  /** Argument validation failures, which the SDK may throw instead of returning, come back as isError results too. */
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
    try {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
    }
  };
  return { client, call, dir, deps };
}

export const text = (r: CallToolResult): string => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
export const data = <T = Record<string, any>>(r: CallToolResult): T => r.structuredContent as T;
```

`packages/mcp/test/tools-session.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';

describe('session tools', () => {
  it('registers the session tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['status', 'new_job', 'open_job', 'save_job', 'import_model', 'get_job', 'import_program']));
  });

  it('says when no job is open', async () => {
    const { call } = await connect();
    expect(text(await call('status'))).toBe('No job open. Use new_job or open_job.');
    const r = await call('get_job');
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('No job open. Use new_job or open_job.');
  });

  it('imports by a relative path and names absolute paths in errors (review focus 1)', async () => {
    const { call, dir } = await connect({}, ['cam-part.dxf']);
    await call('new_job', { name: 'Part' });
    const imported = await call('import_model', { path: 'cam-part.dxf' });
    expect(imported.isError).toBeFalsy();
    expect(data(imported).status).toBe('imported');
    expect(text(imported)).toContain('Imported cam-part.dxf as a drawing');
    const missing = await call('import_model', { path: 'nope.stl' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain(`Could not read ${join(dir, 'nope.stl')}`);
    const badDir = await call('save_job', { path: join('no-such-dir', 'part') });
    expect(badDir.isError).toBe(true);
    expect(text(badDir)).toContain(join(dir, 'no-such-dir', 'part.spon'));
    const saved = await call('save_job', { path: 'part' });
    expect(data(saved).path).toBe(join(dir, 'part.spon'));
    expect(existsSync(join(dir, 'part.spon'))).toBe(true);
  });

  it('refuses to switch away from unsaved changes unless told to discard them', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job');
    expect((await call('new_job')).isError).toBeFalsy(); // an untouched job has nothing to lose
    await call('import_model', { path: 'cam-part.dxf' });
    const refused = await call('new_job');
    expect(refused.isError).toBe(true);
    expect(text(refused)).toBe('The current job has unsaved changes — save_job first, or pass discard: true');
    expect((await call('new_job', { discard: true })).isError).toBeFalsy();
  });

  it('asks for units and bodies', async () => {
    const { call } = await connect({}, ['plate-pocket.stl', 'two-bodies.step']);
    await call('new_job');
    expect(data(await call('import_model', { path: 'plate-pocket.stl' })).status).toBe('needsUnits');
    expect(data(await call('import_model', { path: 'plate-pocket.stl', units: 'mm' })).status).toBe('imported');
    const bodies = await call('import_model', { path: 'two-bodies.step' });
    expect(data(bodies).status).toBe('needsBody');
    expect(text(bodies)).toContain('Call import_model again with body');
    expect(data(await call('import_model', { path: 'two-bodies.step', body: 1 })).status).toBe('imported');
  });

  it('opens a saved job and reads sections of it', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job', { name: 'Saved' });
    await call('import_model', { path: 'cam-part.dxf' });
    await call('save_job', { path: 'saved' });
    await call('new_job', { name: 'Other' });
    const opened = await call('open_job', { path: 'saved.spon' });
    expect(data(opened).session).toMatchObject({ name: 'Saved', dirty: false, model: { sourceName: 'cam-part.dxf' } });
    expect(data(await call('get_job', { section: 'tools' }))).toEqual({ tools: [] });
    expect(data(await call('get_job')).job.name).toBe('Saved');
  });

  it('adds a G-code program', async () => {
    const { call } = await connect({}, ['drill-arc.nc']);
    await call('new_job');
    expect(data(await call('import_program', { path: 'drill-arc.nc' })).program).toMatchObject({ name: 'drill-arc.nc' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test tools-session`
Expected: FAIL (cannot resolve `../src/server`).

- [ ] **Step 3: Implement the server core**

`packages/mcp/src/tools/result.ts`:

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { debugLog } from '../log';

export type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function ok(text: string, data?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], ...(data ? { structuredContent: data } : {}) };
}

export function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message(err) }] };
}

/** Runs a tool body; anything it throws becomes an isError result, never a protocol error. */
export function guarded<A>(name: string, body: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    debugLog(`${name} ${JSON.stringify(args)}`);
    try {
      return await body(args);
    } catch (err) {
      debugLog(`${name} failed: ${message(err)}`);
      return failure(err);
    }
  };
}
```

`packages/mcp/src/state.ts`:

```ts
import { HandleMap } from './handles';
import { type JobSession, SessionError } from './session';

export const NO_JOB = 'No job open. Use new_job or open_job.';

/** The one current session and the geometry handles of its latest catalog. */
export class ServerState {
  session: JobSession | null = null;
  readonly handles = new HandleMap();

  requireSession(): JobSession {
    if (!this.session) throw new SessionError(NO_JOB);
    return this.session;
  }

  async ensureCanSwitch(discard = false): Promise<void> {
    if (!this.session || discard) return;
    const info = await this.session.describe();
    if (info.kind === 'file' && info.dirty) throw new SessionError('The current job has unsaved changes — save_job first, or pass discard: true');
  }

  use(session: JobSession): void {
    this.session = session;
    this.handles.clear();
  }
}
```

`packages/mcp/src/context.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OcctLoader } from '@sponcam/core';
import type { FileSessionOptions } from './fileSession';
import { SessionError, type ToolLibraryAccess } from './session';
import { ServerState } from './state';

export interface ServerDeps {
  /** Relative tool paths resolve against this directory (the server's working directory). */
  cwd: string;
  library: ToolLibraryAccess;
  loadReader: OcctLoader;
  rasterize(svg: string): Promise<Uint8Array>;
  /** A fixed date for posted file headers (tests). */
  postDate?: string;
}

export interface ToolContext {
  deps: ServerDeps;
  state: ServerState;
  resolvePath(path: string): string;
  /** Reads a file by a tool path; errors name the absolute path. */
  readInput(path: string): Promise<{ path: string; bytes: Uint8Array }>;
  sessionOptions(): FileSessionOptions;
  /** The open job's tool library, or the headless library file when no job is open. */
  library(): ToolLibraryAccess;
}

export function createContext(deps: ServerDeps): ToolContext {
  const state = new ServerState();
  const resolvePath = (path: string) => resolve(deps.cwd, path);
  return {
    deps,
    state,
    resolvePath,
    async readInput(path) {
      const abs = resolvePath(path);
      try {
        return { path: abs, bytes: new Uint8Array(await readFile(abs)) };
      } catch (err) {
        throw new SessionError(`Could not read ${abs}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    sessionOptions: () => ({ library: deps.library, loadReader: deps.loadReader, ...(deps.postDate ? { postDate: deps.postDate } : {}) }),
    library: () => state.session?.tools ?? deps.library,
  };
}
```

`packages/mcp/src/instructions.ts`:

```ts
export const INSTRUCTIONS = `Spon is a 2.5D CAM tool. This server creates and edits Spon jobs (.spon files) and posts G-code.

Units and coordinates
- All lengths are millimetres. Coordinates in results are program coordinates: relative to the job's work origin (WCS), Z up.
- Paths may be absolute or relative to the server's working directory.

Typical flow
1. new_job (or open_job for an existing .spon).
2. import_model with an STL, STEP, IGES or DXF file. If it answers needsUnits or needsBody, call it again with units or body.
3. Set up with apply_commands: rotateQuarter / layFlat / setZSpin to orient, setStock, setWcs, applyMachinePreset, setPost { dialect: "grbl" | "linuxcnc" | "fanuc" }.
4. describe_geometry lists what can be machined, with short handles: faces F1, F2… (top down, horizontal and facing up), their loops F1.L0 (outer), F1.L1…, holes H1…, and DXF contours C1…. Call it again after importing or reorienting.
5. add_operation for each operation: type profile, pocket or drill; a tool from list_tools (job tool id, T number, or library tool id); geometry handles; params.
6. generate: read each operation's status and diagnostics and fix errors with apply_commands (updateOperation).
7. render_preview (top, then iso) to check the toolpaths by eye: feeds are solid, rapids dashed, red hatching is material the tool cannot reach.
8. export_gcode into a folder, and save_job to a .spon path. The user can open the .spon in the Spon web app.

Operation parameters (add_operation params, or updateOperation patch)
- heights: { clearance, retract, feed, top, bottom }, each { from, offset }. from is one of stockTop, stockBottom, modelTop, modelBottom, contour, face, origin, holeBottom, retract, feed, top.
- profile: side (outside | inside | on), direction (climb | conventional), stepdown, stockRadial, finishPass, leads { mode, length }, tabs { enabled, shape, width, height, placement (count | spacing), count, spacing }.
- pocket: stepdown, stepoverPct, finishWalls, finishFloor, entry { mode: auto | helix | ramp | plunge }.
- drill: cycle (drill | dwell | peck | chipbreak), peck, dwellSeconds, diameterFilter { min, max }.
- feeds: { rpm, feed, plungeFeed, coolant }.

Always tell the user about export warnings: they do not block the export.`;
```

`packages/mcp/src/tools/session.ts`:

```ts
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Vec3 } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { FileSession } from '../fileSession';
import { dialectSchema, lengthUnitSchema, machinePresetSchema } from '../schemas';
import { type ImportOutcome, SessionError, type SessionInfo } from '../session';
import { NO_JOB } from '../state';
import { type Args, guarded, ok } from './result';

const size = (v: Vec3) => `${v.x.toFixed(2)} × ${v.y.toFixed(2)} × ${v.z.toFixed(2)}`;

export function statusText(info: SessionInfo): string {
  const where = info.path ?? 'not saved yet';
  const model = info.model ? `${info.model.sourceName} (${info.model.format}${info.model.body !== null ? `, body ${info.model.body}` : ''})` : 'none';
  return `Job "${info.name}" (${where})${info.dirty ? ', unsaved changes' : ''}. Model: ${model}. Operations: ${info.operations}.`;
}

function importText(name: string, o: Exclude<ImportOutcome, { status: 'error' }>): string {
  switch (o.status) {
    case 'imported':
      return [
        `Imported ${name} as a ${o.kind}, ${size(o.size)} mm (file units: ${o.units}).`,
        ...o.warnings.map((w) => `Warning: ${w}`),
        'Next: orient and set up with apply_commands if needed, then describe_geometry.',
      ].join('\n');
    case 'needsUnits':
      return `${name} does not say which units it uses. In file units it measures ${size(o.rawSize)}; ${o.suggested} looks likely. Call import_model again with units ("mm" or "in").`;
    case 'needsBody':
      return [
        `${name} has ${o.bodies.length} bodies:`,
        ...o.bodies.map((b, i) => `${i}: ${b.name} — ${b.triangles} triangles, ${size(b.size)} mm`),
        `Call import_model again with body (the largest is ${o.suggested}).`,
      ].join('\n');
  }
}

const SECTIONS = ['operations', 'tools', 'stock', 'wcs', 'machine', 'post', 'model', 'programs'] as const;

const newJobShape = {
  name: z.string().optional().describe('Job name'),
  machinePreset: machinePresetSchema.optional(),
  dialect: dialectSchema.optional().describe('Post-processor dialect (default grbl)'),
  discard: z.boolean().optional().describe('Drop unsaved changes to the current job'),
};
const openJobShape = { path: z.string().describe('A .spon file'), discard: z.boolean().optional().describe('Drop unsaved changes to the current job') };
const saveJobShape = { path: z.string().optional().describe('Where to save; .spon is added. Required for the first save.') };
const importModelShape = {
  path: z.string().describe('An STL, STEP/STP, IGES/IGS or DXF file'),
  units: lengthUnitSchema.optional().describe('Only used when the file does not declare its units (STL, DXF without $INSUNITS)'),
  body: z.number().int().min(0).optional().describe('Which body of a multi-body STEP file'),
};
const getJobShape = { section: z.enum(SECTIONS).optional().describe('Return one part of the job instead of all of it') };
const importProgramShape = { path: z.string().describe('A G-code file (.nc, .ngc, .gcode, .tap, .cnc)') };

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('status', {
    title: 'Status',
    description: 'The open job: its file, unsaved changes, model and number of operations.',
    inputSchema: {},
  }, guarded('status', async () => {
    const info = state.session ? await state.session.describe() : null;
    return ok(info ? statusText(info) : NO_JOB, { session: info, liveTab: null });
  }));

  server.registerTool('new_job', {
    title: 'New job',
    description: 'Start a new job in memory; save it with save_job. Refused while the open job has unsaved changes, unless discard is true.',
    inputSchema: newJobShape,
  }, guarded('new_job', async (a: Args<typeof newJobShape>) => {
    await state.ensureCanSwitch(a.discard);
    state.use(FileSession.create(a, ctx.sessionOptions()));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nNext: import_model.`, { session: info });
  }));

  server.registerTool('open_job', {
    title: 'Open job',
    description: 'Open a .spon job file. Refused while the open job has unsaved changes, unless discard is true.',
    inputSchema: openJobShape,
  }, guarded('open_job', async (a: Args<typeof openJobShape>) => {
    await state.ensureCanSwitch(a.discard);
    state.use(await FileSession.open(ctx.resolvePath(a.path), ctx.sessionOptions()));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nNext: describe_geometry or generate.`, { session: info });
  }));

  server.registerTool('save_job', {
    title: 'Save job',
    description: 'Save the job as a .spon file (the model and programs are stored inside it).',
    inputSchema: saveJobShape,
  }, guarded('save_job', async (a: Args<typeof saveJobShape>) => {
    const path = await state.requireSession().save(a.path === undefined ? undefined : ctx.resolvePath(a.path));
    return ok(`Saved ${path}`, { path });
  }));

  server.registerTool('import_model', {
    title: 'Import model',
    description: 'Load a model into the job (replacing any model). Answers needsUnits or needsBody when it needs a choice; call again with it.',
    inputSchema: importModelShape,
  }, guarded('import_model', async (a: Args<typeof importModelShape>) => {
    const session = state.requireSession();
    const input = await ctx.readInput(a.path);
    const name = basename(input.path);
    const outcome = await session.importModel({ fileName: name, bytes: input.bytes, units: a.units, body: a.body });
    if (outcome.status === 'error') throw new SessionError(`Could not import ${input.path}: ${outcome.error}`);
    if (outcome.status === 'imported') state.handles.clear();
    return ok(importText(name, outcome), { ...outcome });
  }));

  server.registerTool('get_job', {
    title: 'Get job',
    description: 'The job as JSON (lengths in mm), or one section of it.',
    inputSchema: getJobShape,
  }, guarded('get_job', async (a: Args<typeof getJobShape>) => {
    const job = await state.requireSession().job();
    if (!a.section) return ok(JSON.stringify(job, null, 2), { job });
    const value = job[a.section];
    return ok(JSON.stringify(value, null, 2), { [a.section]: value });
  }));

  server.registerTool('import_program', {
    title: 'Import G-code program',
    description: "Add an existing G-code file to the job's program list (for analysis and playback in the web app).",
    inputSchema: importProgramShape,
  }, guarded('import_program', async (a: Args<typeof importProgramShape>) => {
    const session = state.requireSession();
    const input = await ctx.readInput(a.path);
    const program = await session.importProgram(basename(input.path), input.bytes);
    return ok(`Added the program ${program.name} (${program.id}) to the job.`, { program });
  }));
}
```

`packages/mcp/src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createContext, type ServerDeps } from './context';
import { INSTRUCTIONS } from './instructions';
import { registerSessionTools } from './tools/session';
import { VERSION } from './version';

export type { ServerDeps } from './context';

export function createSponServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'spon', version: VERSION }, { instructions: INSTRUCTIONS });
  const ctx = createContext(deps);
  registerSessionTools(server, ctx);
  server.registerPrompt('spon-cam-basics', {
    title: 'Spon CAM basics',
    description: 'How to drive Spon: units, geometry handles and the usual order of tools.',
  }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: INSTRUCTIONS } }] }));
  return server;
}
```

Notes for the implementer:
- Read the installed SDK's `McpServer.registerTool` / `registerPrompt` signatures in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`. If 1.31 differs (for example, `inputSchema` taking a `z.object` rather than a raw shape), adapt the calls but keep the tool names, descriptions and arguments.
- `structuredContent` must be a plain object: always wrap values in a named key, as above.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/mcp test tools-session && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): server core and the session tools"
```

---

### Task 12: Geometry and editing tools — `describe_geometry`, `apply_commands`, `add_operation`

**Files:**
- Create: `packages/mcp/src/tools/edit.ts`
- Modify: `packages/mcp/src/server.ts` (register them)
- Test: `packages/mcp/test/tools-edit.test.ts`

**Interfaces:**
- Consumes: `ToolContext`, `ServerState.handles` (Task 11), `catalogText` and `HandledCatalog` (Task 9), `jobCommandSchema`, `geometryRefSchema`, `operationPatchSchema`, `operationTypeSchema` (Task 10), `OPERATION_LABELS` (core).
- Produces: `registerEditTools(server: McpServer, ctx: ToolContext): void`.

`add_operation` resolves every handle **before** building any command, so a bad handle changes nothing. It sends one `apply` batch: `[addTool?] + addOperation + updateOperation` (with the geometry and params), which is all or nothing. It finds the tool in this order:
- a number: a job tool with that T number, then a library tool with it;
- a string: a job tool id, then a library tool id.

A library tool is copied in with `addTool`, and a clashing T number fails that command.

- [ ] **Step 1: Write the failing test**

`packages/mcp/test/tools-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';
import { tool6 } from './helpers';

async function dxfJob() {
  const t = await connect({}, ['cam-part.dxf']);
  await t.call('new_job', { name: 'Part' });
  await t.call('import_model', { path: 'cam-part.dxf' });
  return t;
}
const handleOn = (catalog: { contours: { handle: string; layer: string }[] }, layer: string) => catalog.contours.find((c) => c.layer === layer)!.handle;

describe('editing tools', () => {
  it('asks for a model before describing geometry', async () => {
    const { call } = await connect();
    await call('new_job');
    expect(text(await call('describe_geometry'))).toBe('The job has no model yet. Use import_model first.');
  });

  it('describes geometry with handles and filters it', async () => {
    const { call } = await dxfJob();
    const all = await call('describe_geometry');
    expect(text(all)).toMatch(/^C1 contour on layer/m);
    expect(data(all).stockBox).not.toBeNull();
    const holes = data(await call('describe_geometry', { filter: 'holes' }));
    expect(holes.contours).toEqual([]);
    expect(holes.holes.length).toBeGreaterThan(0);
  });

  it('adds an operation with a library tool, handles and params', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline], params: { tabs: { enabled: true } } });
    expect(added.isError).toBeFalsy();
    expect(data(added).operation).toMatchObject({ type: 'profile', toolId: 'starter-flat-6', tabs: { enabled: true } });
    expect(data(added).operation.geometry).toHaveLength(1);
    const tools = data(await call('get_job', { section: 'tools' })).tools;
    expect(tools.map((t: { id: string }) => t.id)).toEqual(['starter-flat-6']);
    const byNumber = await call('add_operation', { type: 'profile', tool: tools[0].number, geometry: [outline.toLowerCase()] });
    expect(data(byNumber).operation.toolId).toBe('starter-flat-6');
    expect(data(await call('get_job', { section: 'tools' })).tools).toHaveLength(1);
  });

  it('rejects a stale handle after a new import (review focus 3)', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    await call('import_model', { path: 'cam-part.dxf' });
    const r = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(`Unknown handle ${outline} — call describe_geometry for the current list`);
  });

  it('applies nothing when a library tool clashes with a job T number (review focus 4)', async () => {
    const { call, deps } = await dxfJob();
    const starter = (await deps.library.list()).find((t) => t.id === 'starter-flat-6')!;
    expect((await call('apply_commands', { commands: [{ type: 'addTool', tool: { ...tool6, id: 'mine', number: starter.number } }] })).isError).toBeFalsy();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const r = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(`commands[0] addTool: T${starter.number} is already used by "${tool6.name}"`);
    expect(data(await call('get_job', { section: 'operations' })).operations).toEqual([]);
  });

  it('names an unknown tool', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    expect(text(await call('add_operation', { type: 'profile', tool: 'nope', geometry: [outline] }))).toBe('No tool nope in the job or the library — see list_tools');
  });

  it('applies commands atomically and reports what changed', async () => {
    const { call } = await dxfJob();
    const done = await call('apply_commands', { commands: [{ type: 'renameJob', name: 'Bracket' }, { type: 'setPost', patch: { dialect: 'linuxcnc' } }] });
    expect(data(done).changed).toEqual(['name', 'post']);
    const bad = await call('apply_commands', { commands: [{ type: 'renameJob', name: 'X' }, { type: 'removeOperation', id: 'nope' }] });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toBe('commands[1] removeOperation: No operation with id nope');
    expect(data(await call('get_job')).job.name).toBe('Bracket');
  });

  it('rejects unknown operation parameters', async () => {
    const { call } = await dxfJob();
    const outline = handleOn(data(await call('describe_geometry')), 'OUTLINE');
    const r = await call('add_operation', { type: 'pocket', tool: 'starter-flat-6', geometry: [outline], params: { stepovr: 40 } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('stepovr');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test tools-edit`
Expected: FAIL (the tools are not registered: calls come back as "tool not found" errors).

- [ ] **Step 3: Implement `packages/mcp/src/tools/edit.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type BBox, type Job, type JobCommand, OPERATION_LABELS } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { catalogText, type HandledCatalog } from '../handles';
import { geometryRefSchema, jobCommandSchema, operationPatchSchema, operationTypeSchema } from '../schemas';
import { type JobSession, SessionError } from '../session';
import { type Args, guarded, ok } from './result';

const box = (b: BBox | null) =>
  (b ? `X ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)}, Y ${b.min.y.toFixed(3)} to ${b.max.y.toFixed(3)}, Z ${b.min.z.toFixed(3)} to ${b.max.z.toFixed(3)}` : 'none');

/** Finds the tool for add_operation; a library tool is copied into the job by pushing an addTool command. */
async function resolveTool(job: Job, session: JobSession, tool: string | number, commands: JobCommand[]): Promise<string> {
  const match = (t: { id: string; number: number }) => (typeof tool === 'number' ? t.number === tool : t.id === tool);
  const inJob = job.tools.find(match);
  if (inJob) return inJob.id;
  const fromLibrary = (await session.tools.list()).find(match);
  if (!fromLibrary) throw new SessionError(`No tool ${typeof tool === 'number' ? `T${tool}` : tool} in the job or the library — see list_tools`);
  commands.push({ type: 'addTool', tool: fromLibrary });
  return fromLibrary.id;
}

const describeShape = { filter: z.enum(['faces', 'holes', 'contours']).optional().describe('Only list one kind of geometry') };
const applyShape = {
  commands: z.array(jobCommandSchema).min(1).describe('Job commands, applied in order, all or nothing'),
  label: z.string().optional().describe('A short description of the change'),
};
const addOperationShape = {
  type: operationTypeSchema,
  tool: z.union([z.string(), z.number().int()]).describe('A job tool id, a T number, or a library tool id (see list_tools). Library tools are copied into the job.'),
  geometry: z.array(z.union([z.string(), geometryRefSchema])).min(1).describe('Handles from describe_geometry (F1, F1.L0, H2, C3) or full geometry refs'),
  params: operationPatchSchema.omit({ geometry: true, toolId: true }).optional().describe('Operation parameters, e.g. { "side": "outside", "tabs": { "enabled": true } }'),
  name: z.string().optional(),
};

export function registerEditTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('describe_geometry', {
    title: 'Describe geometry',
    description: 'What can be machined in the current orientation, with handles: faces F1… (top down), face loops F1.L0…, holes H1…, DXF contours C1…. Program coordinates in mm.',
    inputSchema: describeShape,
  }, guarded('describe_geometry', async (a: Args<typeof describeShape>) => {
    const session = state.requireSession();
    const catalog = await session.catalog();
    if (!catalog) throw new SessionError('The job has no model yet. Use import_model first.');
    const handled = state.handles.assign(catalog);
    const shown: HandledCatalog = a.filter ? { faces: [], holes: [], contours: [], [a.filter]: handled[a.filter] } : handled;
    const { model, stock } = await session.boxes();
    const listing = catalogText(shown) || 'Nothing to pick here (faces must be horizontal and face up).';
    return ok(`Model box: ${box(model)}. Stock box: ${box(stock)}.\n${listing}`, { ...shown, modelBox: model, stockBox: stock });
  }));

  server.registerTool('apply_commands', {
    title: 'Apply commands',
    description: 'Edit the job with Spon job commands (orientation, stock, WCS, machine, post, tools, operations, programs). All apply, or none do.',
    inputSchema: applyShape,
  }, guarded('apply_commands', async (a: Args<typeof applyShape>) => {
    const session = state.requireSession();
    const before = await session.job();
    const after = await session.apply(a.commands, a.label);
    const changed = (Object.keys(after) as (keyof Job)[]).filter((k) => after[k] !== before[k]);
    const operations = after.operations.map((o) => ({ id: o.id, name: o.name, type: o.type, enabled: o.enabled }));
    const summary = changed.length ? `Applied ${a.commands.length} command(s). Changed: ${changed.join(', ')}.` : `Applied ${a.commands.length} command(s); nothing changed.`;
    return ok(summary, { changed, operations });
  }));

  server.registerTool('add_operation', {
    title: 'Add operation',
    description: 'Add a profile, pocket or drill operation with its tool, geometry and parameters in one step. Nothing changes if any part fails.',
    inputSchema: addOperationShape,
  }, guarded('add_operation', async (a: Args<typeof addOperationShape>) => {
    const session = state.requireSession();
    const refs = a.geometry.map((g) => state.handles.resolve(g));
    const job = await session.job();
    const commands: JobCommand[] = [];
    const toolId = await resolveTool(job, session, a.tool, commands);
    const id = crypto.randomUUID();
    commands.push(
      { type: 'addOperation', opType: a.type, toolId, id, ...(a.name ? { name: a.name } : {}) },
      { type: 'updateOperation', id, patch: { ...(a.params ?? {}), geometry: refs } },
    );
    const on = a.geometry.map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : g.kind)).join(', ');
    const after = await session.apply(commands, `Add ${OPERATION_LABELS[a.type]} on ${on}`);
    const op = after.operations.find((o) => o.id === id)!;
    return ok(`Added ${op.name} (${op.id}) on ${on} with tool ${toolId}. Next: generate.`, { operation: op });
  }));
}
```

Register the tools in `packages/mcp/src/server.ts`: add `import { registerEditTools } from './tools/edit';` and call `registerEditTools(server, ctx);` after `registerSessionTools`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/mcp test tools-edit && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

If the "describes geometry" test finds no holes for the DXF, check how `describeGeometry` lists DXF circles (they appear under `holes` in the Milestone 3 catalog). Assert on the list that actually carries the four HOLES circles, and note the change in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): describe_geometry, apply_commands and add_operation"
```

---

### Task 13: Output and library tools, resources and the prompt

**Files:**
- Create: `packages/mcp/src/tools/output.ts`, `packages/mcp/src/tools/library.ts`, `packages/mcp/src/resources.ts`
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/test/tools-output.test.ts`, `packages/mcp/test/tools-library.test.ts`

**Interfaces:**
- Consumes: `ToolContext` (Task 11); `exportProblems`, `exportInputFromRun` (core); `toolSchema` (Task 10).
- Produces: `registerOutputTools`, `registerLibraryTools`, `registerResources` (each `(server: McpServer, ctx: ToolContext) => void`).

Tool results:
- **`generate`** returns `structuredContent`:
  - `operations`: `[{ id, name, type, status: 'ok' | 'warning' | 'error' | 'disabled', diagnostics: [{ severity, code, message }], heights }]`
  - `files`: `[{ name, lines, tools, seconds }]`
  - `cycleSeconds`, `extents` (BBox | null), `stock` (BBox | null)
  - `export`: `{ errors, warnings }`
- **`get_gcode`**: at most 400 lines per call (`MAX_GCODE_LINES`).
- **`export_gcode`**: writes nothing when there are errors.

- [ ] **Step 1: Write the failing tests**

`packages/mcp/test/tools-output.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerDeps } from '../src/server';
import { connect, data, text } from './connect';

async function profiled(overrides: Partial<ServerDeps> = {}) {
  const t = await connect(overrides, ['cam-part.dxf']);
  await t.call('new_job', { name: 'Part' });
  await t.call('import_model', { path: 'cam-part.dxf' });
  const catalog = data(await t.call('describe_geometry'));
  const outline = catalog.contours.find((c: { layer: string }) => c.layer === 'OUTLINE').handle;
  const op = data(await t.call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: [outline] })).operation;
  return { ...t, op };
}

describe('output tools', () => {
  it('generates and summarises every operation and file', async () => {
    const { call, op } = await profiled();
    const r = await call('generate');
    const d = data(r);
    expect(d.operations[0].id).toBe(op.id);
    expect(['ok', 'warning']).toContain(d.operations[0].status);
    expect(d.files).toHaveLength(1);
    expect(d.cycleSeconds).toBeGreaterThan(0);
    expect(d.export.errors).toEqual([]);
    expect(text(r)).toContain('Cycle time');
  });

  it('writes posted files and writes nothing while there are errors', async () => {
    const { call, dir } = await profiled();
    const written = await call('export_gcode', { dir: 'out' });
    expect(written.isError).toBeFalsy();
    const paths = data(written).paths as string[];
    expect(paths[0].startsWith(join(dir, 'out'))).toBe(true);
    expect(readFileSync(paths[0], 'utf8')).toContain('Spon 2026-01-01');
    await call('apply_commands', { commands: [{ type: 'addOperation', opType: 'pocket', toolId: null, id: 'empty' }] });
    const blocked = await call('export_gcode', { dir: 'out2' });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('Export blocked by errors:');
    expect(existsSync(join(dir, 'out2'))).toBe(false);
  });

  it('pages through posted G-code', async () => {
    const { call } = await profiled();
    const name = data(await call('generate')).files[0].name;
    const first = data(await call('get_gcode'));
    expect(first).toMatchObject({ file: name, from: 1 });
    expect(first.to - first.from + 1).toBeLessThanOrEqual(400);
    expect(data(await call('get_gcode', { file: name, lines: [2, 3] })).text.split('\n')).toHaveLength(2);
    expect((await call('get_gcode', { file: 'nope.nc' })).isError).toBe(true);
  });

  it('renders a preview through the rasteriser', async () => {
    const svgs: string[] = [];
    const { call } = await profiled({ rasterize: async (svg) => { svgs.push(svg); return new Uint8Array([137, 80, 78, 71]); } });
    const r = await call('render_preview', { view: 'iso' });
    expect(r.content[0]).toEqual({ type: 'image', mimeType: 'image/png', data: Buffer.from([137, 80, 78, 71]).toString('base64') });
    expect(svgs[0]).toContain('<g id="op-0"');
    expect(text(await call('render_preview', { operations: ['nope'] }))).toBe('No operation with id nope');
  });

  it('exposes the job, the catalog and posted G-code as resources', async () => {
    const { client, call } = await profiled();
    await call('generate');
    const job = await client.readResource({ uri: 'spon://job' });
    expect(JSON.parse((job.contents[0] as { text: string }).text).name).toBe('Part');
    const catalog = await client.readResource({ uri: 'spon://catalog' });
    expect(JSON.parse((catalog.contents[0] as { text: string }).text).contours[0].handle).toBe('C1');
    const gcode = (await client.listResources()).resources.find((r) => r.uri.startsWith('spon://gcode/'))!;
    expect(((await client.readResource({ uri: gcode.uri })).contents[0] as { text: string }).text).toContain('Spon 2026-01-01');
  });

  it('sends instructions and the basics prompt', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain('describe_geometry');
    const prompt = await client.getPrompt({ name: 'spon-cam-basics' });
    expect((prompt.messages[0].content as { text: string }).text).toContain('import_model');
  });
});
```

`packages/mcp/test/tools-library.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportToolLibrary } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { connect, data, text } from './connect';
import { tool6 } from './helpers';

describe('library tools', () => {
  it('lists, filters, adds and imports tools', async () => {
    const { call, dir } = await connect();
    const all = data(await call('list_tools')).tools as { source: string; type: string; id: string }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => t.source === 'library')).toBe(true);
    expect((data(await call('list_tools', { type: 'drill' })).tools as { type: string }[]).every((t) => t.type === 'drill')).toBe(true);
    expect((await call('add_library_tool', { tool: { ...tool6, id: 'mine', number: 90 } })).isError).toBeFalsy();
    expect((data(await call('list_tools', { query: '6 MM FLAT' })).tools as { id: string }[]).some((t) => t.id === 'mine')).toBe(true);
    writeFileSync(join(dir, 'lib.json'), exportToolLibrary([{ ...tool6, id: 'imported', number: 91 }]));
    expect(text(await call('import_tool_library', { path: 'lib.json' }))).toContain('Imported 1 new and 0 updated tool(s)');
  });

  it('lists job tools before library tools', async () => {
    const { call } = await connect();
    await call('new_job');
    await call('apply_commands', { commands: [{ type: 'addTool', tool: tool6 }] });
    const tools = data(await call('list_tools')).tools as { source: string; id: string }[];
    expect(tools[0]).toMatchObject({ source: 'job', id: 't6' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sponcam/mcp test tools-output tools-library`
Expected: FAIL (the tools are not registered).

- [ ] **Step 3: Implement `packages/mcp/src/tools/output.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type BBox, exportInputFromRun, exportProblems } from '@sponcam/core';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { SessionError } from '../session';
import { type Args, guarded, message, ok } from './result';

export const MAX_GCODE_LINES = 400;

const fmtTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};
const range = (b: BBox) =>
  `X ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)}, Y ${b.min.y.toFixed(3)} to ${b.max.y.toFixed(3)}, Z ${b.min.z.toFixed(3)} to ${b.max.z.toFixed(3)}`;
const union = (a: BBox | null, b: BBox): BBox => (a
  ? {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  }
  : b);

const previewShape = {
  view: z.enum(['top', 'front', 'iso']).optional().describe('Default top'),
  operations: z.array(z.string()).optional().describe('Operation ids to show (default: all enabled)'),
  size: z.number().int().min(256).max(2048).optional().describe('Long edge in pixels (default 1024)'),
};
const gcodeShape = {
  file: z.string().optional().describe('A file name from generate (default: the first)'),
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional().describe(`First and last line, 1-based; at most ${MAX_GCODE_LINES} lines per call`),
};
const exportShape = { dir: z.string().describe('Folder for the posted files (created if missing)') };

export function registerOutputTools(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;

  server.registerTool('generate', {
    title: 'Generate',
    description: 'Generate and post every operation. Returns each operation status and diagnostics, the posted files, cycle time, toolpath extents against the stock, and whether export is possible.',
    inputSchema: {},
  }, guarded('generate', async () => {
    const session = state.requireSession();
    const job = await session.job();
    const run = await session.run();
    const { stock } = await session.boxes();
    const results = new Map(run.results.map((r) => [r.operationId, r]));
    const operations = job.operations.map((op) => {
      const r = results.get(op.id);
      const diagnostics = (r?.diagnostics ?? []).map(({ severity, code, message: text }) => ({ severity, code, message: text }));
      const status = !op.enabled ? 'disabled' : diagnostics.some((d) => d.severity === 'error') ? 'error' : diagnostics.length ? 'warning' : 'ok';
      return { id: op.id, name: op.name, type: op.type, status, diagnostics, heights: r?.heights ?? null };
    });
    const files = run.files.map((f) => ({ name: f.name, lines: f.parsed.analysis.summary.lineCount, tools: f.tools, seconds: f.parsed.analysis.summary.totalSeconds }));
    const cycleSeconds = files.reduce((t, f) => t + f.seconds, 0);
    let extents: BBox | null = null;
    for (const f of run.files) if (f.parsed.analysis.summary.extents) extents = union(extents, f.parsed.analysis.summary.extents);
    const verdict = exportProblems(exportInputFromRun(job, run));
    const lines = [
      ...operations.map((o) => `${o.status.toUpperCase()} ${o.name} (${o.type}, ${o.id})${o.diagnostics.map((d) => `\n  ${d.severity}: ${d.message}`).join('')}`),
      ...files.map((f) => `${f.name}: ${f.lines} lines, ${f.tools.length ? `T${f.tools.join(', T')}` : 'no tool change'}, ${fmtTime(f.seconds)}`),
      `Cycle time ${fmtTime(cycleSeconds)}.`,
      extents ? `Toolpath extents: ${range(extents)}.` : 'No toolpaths.',
      stock ? `Stock: ${range(stock)}.` : 'No stock (import a model).',
      verdict.errors.length
        ? `Export blocked by ${verdict.errors.length} error(s):\n${verdict.errors.map((e) => `- ${e}`).join('\n')}`
        : `Ready to export${verdict.warnings.length ? ` with ${verdict.warnings.length} warning(s) to tell the user about` : ''}.`,
    ];
    return ok(lines.join('\n'), { operations, files, cycleSeconds, extents, stock, export: verdict });
  }));

  server.registerTool('render_preview', {
    title: 'Render preview',
    description: 'A PNG line drawing of the stock, model and toolpaths: feeds solid, rapids dashed, one colour per operation, red hatching where the tool cannot reach.',
    inputSchema: previewShape,
  }, guarded('render_preview', async (a: Args<typeof previewShape>) => {
    const session = state.requireSession();
    const job = await session.job();
    for (const id of a.operations ?? []) if (!job.operations.some((o) => o.id === id)) throw new SessionError(`No operation with id ${id}`);
    const view = a.view ?? 'top';
    const png = await ctx.deps.rasterize(await session.previewSvg({ view, size: a.size, operations: a.operations }));
    const shown = a.operations?.length ?? job.operations.filter((o) => o.enabled).length;
    return {
      content: [
        { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `${view} view of "${job.name}" with ${shown} operation(s).` },
      ],
    };
  }));

  server.registerTool('get_gcode', {
    title: 'Get G-code',
    description: `Posted G-code text, at most ${MAX_GCODE_LINES} lines per call.`,
    inputSchema: gcodeShape,
  }, guarded('get_gcode', async (a: Args<typeof gcodeShape>) => {
    const run = await state.requireSession().run();
    if (!run.files.length) throw new SessionError('Nothing has been posted: add operations with geometry first');
    const file = a.file ? run.files.find((f) => f.name === a.file) : run.files[0];
    if (!file) throw new SessionError(`No posted file ${a.file}. Files: ${run.files.map((f) => f.name).join(', ')}`);
    const all = file.text.split('\n');
    if (all.at(-1) === '') all.pop();
    const from = a.lines?.[0] ?? 1;
    if (from > all.length) throw new SessionError(`${file.name} has ${all.length} lines`);
    const to = Math.min(all.length, a.lines?.[1] ?? Infinity, from + MAX_GCODE_LINES - 1);
    const text = all.slice(from - 1, to).join('\n');
    return ok(`${file.name}, lines ${from} to ${to} of ${all.length}:\n${text}`, { file: file.name, from, to, total: all.length, text });
  }));

  server.registerTool('export_gcode', {
    title: 'Export G-code',
    description: 'Write the posted files into a folder. Refused while there are errors; warnings are returned and must be passed on to the user.',
    inputSchema: exportShape,
  }, guarded('export_gcode', async (a: Args<typeof exportShape>) => {
    const outcome = await state.requireSession().exportGcode();
    if (!outcome.ok) {
      const warnings = outcome.warnings.length ? ['Warnings:', ...outcome.warnings.map((w) => `- ${w}`)] : [];
      throw new SessionError(['Export blocked by errors:', ...outcome.errors.map((e) => `- ${e}`), ...warnings].join('\n'));
    }
    const dir = ctx.resolvePath(a.dir);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      throw new SessionError(`Could not create ${dir}: ${message(err)}`);
    }
    const paths: string[] = [];
    for (const f of outcome.files) {
      const path = join(dir, f.name);
      try {
        await writeFile(path, f.text);
      } catch (err) {
        throw new SessionError(`Could not write ${path}: ${message(err)}`);
      }
      paths.push(path);
    }
    const lines = [`Wrote ${paths.length} file(s):`, ...paths.map((p) => `- ${p}`)];
    if (outcome.warnings.length) lines.push('Tell the user about these warnings:', ...outcome.warnings.map((w) => `- ${w}`));
    return ok(lines.join('\n'), { paths, warnings: outcome.warnings });
  }));
}
```

- [ ] **Step 4: Implement `packages/mcp/src/tools/library.ts`**

```ts
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../context';
import { toolSchema } from '../schemas';
import { type Args, guarded, ok } from './result';

const listShape = {
  query: z.string().optional().describe('Text in the name, vendor or product id'),
  type: z.enum(['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer']).optional(),
  diameter: z.number().optional().describe('Diameter in mm (±0.01)'),
};
const addShape = { tool: toolSchema.describe('A complete tool; lengths in mm, feeds in mm/min') };
const importShape = { path: z.string().describe('A Spon tool library .json, or a Fusion 360 library .json / .tools') };

export function registerLibraryTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool('list_tools', {
    title: 'List tools',
    description: "Tools in the open job, then the tool library. Use a tool's id or T number in add_operation.",
    inputSchema: listShape,
  }, guarded('list_tools', async (a: Args<typeof listShape>) => {
    const job = ctx.state.session ? await ctx.state.session.job() : null;
    const rows = [
      ...(job?.tools ?? []).map((t) => ({ source: 'job' as const, ...t })),
      ...(await ctx.library().list()).map((t) => ({ source: 'library' as const, ...t })),
    ];
    const q = a.query?.toLowerCase();
    const tools = rows.filter((t) =>
      (!q || [t.name, t.vendor ?? '', t.productId ?? ''].some((s) => s.toLowerCase().includes(q)))
      && (!a.type || t.type === a.type)
      && (a.diameter === undefined || Math.abs(t.diameter - a.diameter) <= 0.01));
    const text = tools.length
      ? tools.map((t) => `[${t.source}] T${t.number} ${t.name} — ${t.type} ⌀${t.diameter} mm, id ${t.id}${t.presets.length ? `; presets: ${t.presets.map((p) => p.name).join(', ')}` : ''}`).join('\n')
      : 'No tools match.';
    return ok(text, { tools });
  }));

  server.registerTool('add_library_tool', {
    title: 'Add library tool',
    description: 'Add a tool to the tool library, or replace the one with the same id. T numbers must stay unique.',
    inputSchema: addShape,
  }, guarded('add_library_tool', async (a: Args<typeof addShape>) => {
    await ctx.library().add(a.tool);
    return ok(`Added T${a.tool.number} ${a.tool.name} (${a.tool.id}) to the tool library.`, { tool: a.tool });
  }));

  server.registerTool('import_tool_library', {
    title: 'Import tool library',
    description: 'Import tools from a Spon library or a Fusion 360 library into the tool library. Taken T numbers are renumbered.',
    inputSchema: importShape,
  }, guarded('import_tool_library', async (a: Args<typeof importShape>) => {
    const input = await ctx.readInput(a.path);
    const result = await ctx.library().importFile(basename(input.path), input.bytes);
    const lines = [
      `Imported ${result.added} new and ${result.updated} updated tool(s) from ${input.path}.`,
      ...result.notes,
      ...result.skipped.map((s) => `Skipped ${s.name}: ${s.reason}`),
    ];
    return ok(lines.join('\n'), { ...result });
  }));
}
```

- [ ] **Step 5: Implement `packages/mcp/src/resources.ts`**

```ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context';
import { SessionError } from './session';

/** Read-only views of the open job. Reading the catalog assigns handles, like describe_geometry. */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  const { state } = ctx;
  const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] });

  server.registerResource('job', 'spon://job', { title: 'Open job', mimeType: 'application/json' },
    async (uri) => json(uri, await state.requireSession().job()));

  server.registerResource('catalog', 'spon://catalog', { title: 'Geometry catalog with handles', mimeType: 'application/json' },
    async (uri) => {
      const catalog = await state.requireSession().catalog();
      return json(uri, catalog ? state.handles.assign(catalog) : null);
    });

  server.registerResource('gcode', new ResourceTemplate('spon://gcode/{file}', {
    list: async () => {
      if (!state.session) return { resources: [] };
      const run = await state.session.run();
      return { resources: run.files.map((f) => ({ uri: `spon://gcode/${encodeURIComponent(f.name)}`, name: f.name, mimeType: 'text/plain' })) };
    },
  }), { title: 'Posted G-code', mimeType: 'text/plain' }, async (uri, { file }) => {
    const name = decodeURIComponent(String(file));
    const posted = (await state.requireSession().run()).files.find((f) => f.name === name);
    if (!posted) throw new SessionError(`No posted file ${name}`);
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: posted.text }] };
  });
}
```

In `packages/mcp/src/server.ts`, import and call `registerOutputTools(server, ctx)`, `registerLibraryTools(server, ctx)` and `registerResources(server, ctx)` after `registerEditTools`. Change the SDK import in `resources.ts` to `import type { McpServer }` if `McpServer` is used only as a type there (`ResourceTemplate` is a value).

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/mcp test && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS (every MCP test so far).

- [ ] **Step 7: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): generate, preview, G-code, export and library tools, resources and prompt"
```

---

### Task 14: Stdio entry point, bundle, end-to-end test, notices and docs

**Files:**
- Create: `packages/mcp/src/main.ts`, `packages/mcp/scripts/build.mjs`, `packages/mcp/README.md`
- Test: `packages/mcp/test/stdio.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`, `.claude/skills/spon-dev/SKILL.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `packages/mcp/dist/spon-mcp.js`, which you run with `node packages/mcp/dist/spon-mcp.js` from inside the repo checkout.

- [ ] **Step 1: Write the failing end-to-end test**

`packages/mcp/test/stdio.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { machinePreset, parseProgram } from '@sponcam/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixturePath, tempDir } from './helpers';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(PKG, 'dist', 'spon-mcp.js');

beforeAll(() => {
  execFileSync(process.execPath, [join(PKG, 'scripts', 'build.mjs')], { cwd: PKG, stdio: 'pipe' });
}, 120_000);

describe('spon-mcp over stdio', () => {
  it('keeps occt-import-js out of the bundle', () => {
    const bundle = readFileSync(DIST, 'utf8');
    expect(bundle.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(bundle).toMatch(/requireFromHere\d*\("occt-import-js"\)/);
    expect(bundle).not.toContain('occt-import-js.wasm');
  });

  it('runs the Milestone 3 flow: DXF → profile with tabs, pocket, drill → GRBL → export and save', async () => {
    const dir = tempDir();
    copyFileSync(fixturePath('cam-part.dxf'), join(dir, 'cam-part.dxf'));
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [DIST], cwd: dir, env: { ...env, SPON_TOOL_LIBRARY: join(dir, 'tools.json') }, stderr: 'pipe',
    });
    const client = new Client({ name: 'spon-e2e', version: '0.0.0' });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
      if (r.isError) throw new Error(`${name}: ${r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')}`);
      return r;
    };
    try {
      await call('new_job', { name: 'Part', dialect: 'grbl' });
      await call('import_model', { path: 'cam-part.dxf' });
      const catalog = (await call('describe_geometry')).structuredContent as { contours: { handle: string; layer: string }[] };
      const on = (layer: string) => catalog.contours.filter((c) => c.layer === layer).map((c) => c.handle);
      await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: on('OUTLINE'), params: { tabs: { enabled: true } } });
      await call('add_operation', { type: 'pocket', tool: 'starter-flat-6', geometry: on('POCKET') });
      await call('add_operation', { type: 'drill', tool: 'starter-drill-6', geometry: on('HOLES') });
      const generated = (await call('generate')).structuredContent as { operations: { status: string }[]; export: { errors: string[] } };
      expect(generated.operations.filter((o) => o.status === 'error')).toEqual([]);
      expect(generated.export.errors).toEqual([]);
      const { paths } = (await call('export_gcode', { dir: 'out' })).structuredContent as { paths: string[] };
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        const parsed = parseProgram(new Uint8Array(readFileSync(p)), { profile: machinePreset('Hobby GRBL router'), stock: null, jobWorkOffset: 'G54' });
        expect(parsed.interpretDiagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      }
      await call('save_job', { path: 'part' });
      expect(existsSync(join(dir, 'part.spon'))).toBe(true);
      const image = (await call('render_preview', { view: 'iso' })).content[0];
      expect(image.type === 'image' && Array.from(Buffer.from(image.data, 'base64').subarray(0, 4))).toEqual([137, 80, 78, 71]);
    } finally {
      await client.close();
    }
  }, 120_000);
});
```

Run: `pnpm --filter @sponcam/mcp test stdio`
Expected: FAIL (`scripts/build.mjs` does not exist).

- [ ] **Step 2: Write `packages/mcp/src/main.ts`**

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultLibraryPath, ToolLibraryFile } from './library';
import { log } from './log';
import { loadNodeOcct } from './occt';
import { svgToPng } from './raster';
import { createSponServer } from './server';
import { VERSION } from './version';

const libraryPath = defaultLibraryPath();
const server = createSponServer({ cwd: process.cwd(), library: new ToolLibraryFile(libraryPath), loadReader: loadNodeOcct, rasterize: svgToPng });
await server.connect(new StdioServerTransport());
log(`spon-mcp ${VERSION} ready in ${process.cwd()} (tool library ${libraryPath})`);
```

- [ ] **Step 3: Write `packages/mcp/scripts/build.mjs`**

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// @sponcam/core is TypeScript source, so it is bundled (with its own dependencies). The MCP package's own
// dependencies stay external and load from node_modules at run time: occt-import-js (LGPL) is never bundled.
const external = Object.keys(pkg.dependencies).filter((name) => name !== '@sponcam/core');

await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/spon-mcp.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...external, ...external.map((name) => `${name}/*`)],
  // bundled CommonJS (dxf-parser) calls require(); ESM has none, so define one
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __sponCreateRequire } from 'node:module';\nconst require = __sponCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
```

Run: `pnpm mcp:build && node -e "import('node:fs').then(fs => console.log(fs.statSync('packages/mcp/dist/spon-mcp.js').size))"`
Expected: the build succeeds, and the bundle is under a few MB.

- [ ] **Step 4: Run the end-to-end test**

Run: `pnpm --filter @sponcam/mcp test stdio`
Expected: PASS.

If the pocket or drill operation comes back with an error status on the fixture (for example the tool is too large for the pocket), read the diagnostic and choose the tool the web app's Milestone 3 e2e uses for that operation (`defaultToolFor` in `web/src/state/toolLibrary.ts`). Do not remove the operation from the test.

- [ ] **Step 5: Write `packages/mcp/README.md`**

```markdown
# Spon MCP server

Lets Claude (or any MCP client) create and edit Spon jobs on disk: import STL, STEP, IGES and DXF models, pick geometry,
add profile, pocket and drill operations, generate, preview, export G-code and save `.spon` files that open in the web app.

## Build and register

From the repo root:

    pnpm install
    pnpm mcp:build
    claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js

The server runs from inside this checkout: its npm dependencies (including the unmodified LGPL `occt-import-js`
reader) load from `packages/mcp/node_modules`. Relative paths in tool calls resolve against the directory Claude Code
starts the server in.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SPON_TOOL_LIBRARY` | `~/.spon/tools.json` | The tool library file (the web app's library export format). Created with the starter tools on first use. |
| `SPON_MCP_LOG` | — | `debug` logs every tool call to stderr. |

To use your browser tool library headless, export it from the web app's tool library dialog and call
`import_tool_library` with the file.

## Tools

`status`, `new_job`, `open_job`, `save_job`, `import_model`, `get_job`, `import_program`, `describe_geometry`,
`apply_commands`, `add_operation`, `generate`, `render_preview`, `get_gcode`, `export_gcode`, `list_tools`,
`add_library_tool`, `import_tool_library`. Resources: `spon://job`, `spon://catalog`, `spon://gcode/{file}`.
Prompt: `spon-cam-basics`.

## Development

    pnpm --filter @sponcam/mcp test
    pnpm --filter @sponcam/mcp typecheck
```

- [ ] **Step 6: Update `THIRD_PARTY_NOTICES.md`**

Append:

```markdown
## Spon MCP server (`packages/mcp`)

The MCP server loads these packages from `node_modules` at run time; none of them is modified or bundled into
`dist/spon-mcp.js`:

- **@modelcontextprotocol/sdk** (MIT) and its dependencies (MIT/ISC/BSD-style).
- **zod** (MIT).
- **@resvg/resvg-wasm** 2.6.2 (MPL-2.0), unmodified; source at https://github.com/yisibl/resvg-js.
- **occt-import-js** 0.0.23 (LGPL-2.1), the same package the web app uses (see above), loaded unmodified with its own
  WebAssembly file. To use a different build, replace `packages/mcp/node_modules/occt-import-js` or change the
  pinned version in `packages/mcp/package.json` and reinstall.

The preview font **Geist Regular** (SIL Open Font License 1.1) is included as `packages/mcp/assets/Geist-Regular.ttf`,
with its licence in `packages/mcp/assets/OFL.txt`.
```

- [ ] **Step 7: Update the dev skill**

In `.claude/skills/spon-dev/SKILL.md`:
- Change the first line of the description paragraph to mention the third package: "`packages/mcp` (the MCP server; Node, stdio)".
- Add rows to the command table:

```markdown
| MCP tests | `pnpm --filter @sponcam/mcp test` (the stdio test builds the bundle first) |
| Build the MCP server | `pnpm mcp:build` → `packages/mcp/dist/spon-mcp.js` |
| Register it with Claude Code | `claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js` |
```

- Add to "Rules that are easy to break":

```markdown
- The MCP server must never write to stdout (it carries the protocol): log with `log`/`debugLog` from `packages/mcp/src/log.ts`.
- Tool failures are `isError` results thrown as `SessionError`/`CommandError` inside `guarded`, never protocol errors.
```

- [ ] **Step 8: Run everything touched and commit**

Run: `pnpm --filter @sponcam/mcp test && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

```bash
git add packages/mcp THIRD_PARTY_NOTICES.md .claude/skills/spon-dev/SKILL.md
git commit -m "feat(mcp): stdio entry point, bundle, end-to-end test, notices and docs"
```

---

### Task 15: Verification

**Files:** none new, apart from fixes to anything that fails.

- [ ] **Step 1: Full test, typecheck and build**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm mcp:build`
Expected: all PASS: core, web and mcp tests, the web production build, and the MCP bundle.

- [ ] **Step 2: Web end-to-end tests (the pipeline move touched the worker)**

Run: `pnpm e2e && pnpm e2e:preview`
Expected: PASS on ports 5199 and 5198. Port 5173 is not touched.

- [ ] **Step 3: Licence check**

Run: `pnpm --filter @sponcam/mcp licenses list --prod`
Expected: no GPL or AGPL licence. The only copyleft entries are `occt-import-js` (LGPL-2.1) and `@resvg/resvg-wasm` (MPL-2.0).

Run: `pnpm --filter @sponcam/mcp licenses list --prod | grep -E "GPL" | grep -v LGPL`
Expected: no output. If anything appears, stop and report it; the user decides.

- [ ] **Step 4: Manual smoke test of the bundle**

```bash
cd "$(mktemp -d)"
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | node <repo>/packages/mcp/dist/spon-mcp.js
```

Expected: one JSON line on stdout with `"serverInfo":{"name":"spon"` and the instructions, the `ready` line on stderr, then the process exits when stdin closes.

- [ ] **Step 5: Check the spec's acceptance criteria that phase 1 covers**

- AC1: the stdio test covers DXF → `.spon` and `.nc`. Also open the saved `.spon` from that flow in the web app (`pnpm dev` is the user's server; ask the user, or use a Playwright-free check: `readSpon` on the file gives the same job).
- AC2: the FileSession tests cover STL and multi-body STEP.
- AC3: `render_preview` returns the PNG; judging it visually is the user's check.
- AC4: the library tests cover the headless library, including Fusion import through the core function (its parser already has core tests).
- AC5 is phase 2. AC6 is Steps 1–2.

Report anything not covered in the final summary rather than claiming it.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: verification fixes for milestone 3.5 phase 1"
```

(Skip this if nothing changed.)
