# Spon Milestone 3.5 — MCP API, Phase 2 (live bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With one click in the Spon web app, Claude drives the job that is open in the browser tab through the same MCP tools it uses headless. Every tool call is one undo step in the tab, and closing the tab is reported cleanly.

**Architecture:**
- The MCP process also listens on `ws://127.0.0.1:5197`, loopback only. `LiveBridge` accepts one tab at a time, after an `Origin` allow-list check and a `hello` handshake.
- `LiveSession` implements the phase 1 `JobSession` interface by sending JSON-RPC 2.0 requests to the tab, so every existing tool works unchanged. A new `use_live_tab` tool makes the tab the current session.
- The tab side (`packages/web/src/bridge/`) is loaded lazily, the first time the user clicks "Claude" in the status bar. It answers each request with the store, the CAM pipeline and the worker the app already uses.
- The wire types, the JSON-safe run report and the import decisions shared by both ends live in core. Both sides compile against one definition.

**Tech Stack:**
- TypeScript 7, Vitest 5, Node ≥ 22, Playwright 1.63;
- `ws` 8 (MIT), new in `@sponcam/mcp`, with `@types/ws` as a dev dependency;
- the browser's own `WebSocket` in the tab;
- `@modelcontextprotocol/sdk` (MIT), added as a dev dependency of `@sponcam/web` for the Playwright test only.

**Spec:** `docs/superpowers/specs/2026-09-30-mcp-api-design.md`, §6 (plus §3, §7, §8 "Bridge", §9 criterion 5). Read it together with this plan. It is the authority; this plan is its argument. Phase 1 is merged (`master` at `007ec3b`); its plan is `docs/superpowers/plans/2026-09-30-spon-milestone-3-5-mcp-phase-1.md`.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs (tsconfig lib `ES2022` + `WebWorker`; `btoa`/`atob` are allowed, they are in both).
- No GPL dependencies. The only new runtime dependency is `ws` (MIT) in `@sponcam/mcp`. `@types/ws` and, in `@sponcam/web`, `@modelcontextprotocol/sdk` are dev dependencies.
- The web app is unchanged for anyone who never enables the bridge. The only always-loaded additions are the status bar item and the tiny `bridge/status.ts`. The client, the handlers and the socket load with `import()` on first enable. Existing web unit and e2e tests pass unchanged.
- The bridge listens on `127.0.0.1` only. The default port is `5197`; `--port <n>` or `SPON_BRIDGE_PORT` change it. Tests use port `0` (any free port) or, in Playwright, `5196`. Never touch port 5173.
- Allowed origins: `http://localhost` and `http://127.0.0.1` on ports 5173, 4173, 5198 and 5199, plus `SPON_ALLOWED_ORIGINS` (comma-separated). A missing `Origin` is refused.
- Request timeouts: 60 s, and 300 s for `importModel`.
- Logging goes to stderr only (`log`/`debugLog` from `packages/mcp/src/log.ts`). Stdout carries the stdio protocol.
- Tool failures are `isError` results, thrown as `SessionError`/`CommandError` inside `guarded`, never protocol errors.
- Fixed messages (copy verbatim):
  - `No job open. Use new_job, open_job or use_live_tab.` (replaces the phase 1 wording)
  - `The tab did not answer within 60 s` (the number is the timeout in seconds)
  - `Tab disconnected`
  - `Disconnected — another tab took over`
  - `This tab has no file yet — give a path`
  - `Another Spon tab is connected`
  - `No Spon tab is connected. In the Spon web app, click "Claude" in the status bar to connect.`
  - `live bridge unavailable: port <n> in use`
- Stored lengths are mm. Job changes in the tab go through the store's `commit()`, so undo works.
- TypeScript runs with `verbatimModuleSyntax`: use `import type` for type-only imports.
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line.
- Never push, and never rewrite history.

## Clarifications to the spec (binding for this plan)

1. **`JobSession.run()` returns a `RunReport`, not a `CamRun`.** A `CamRun` holds typed-array motion tables and overlays that cannot cross a JSON socket. `RunReport` (`core/src/pipeline/report.ts`) keeps what the tools read: per-operation diagnostics and heights; per-file name, text, tools, line count, seconds and extents; and the export verdict. Both sessions build it with the same `runReport(job, run)`.
2. **Shared wire types live in core** (`core/src/bridge/protocol.ts`): `SessionInfo`, `ImportOutcome`, `ExportOutcome`, `LibraryImportResult`, `Boxes`, the `BridgeMethods` map, the handshake types, the close codes and the base64 helpers. `packages/mcp/src/session.ts` re-exports them, so phase 1 imports keep working.
3. **Bridge methods beyond the spec's list:**
   - `describe` and `boxes`, because `JobSession` has them.
   - `save` with a path splits into `saveBytes` (returns the bytes and a token) and `markSaved { token }`, sent only after the server has written the file. The tab clears its dirty flag only if the job has not changed since `saveBytes`.
4. **`dispatchBatch(commands)` takes no label.** The store stays toast-free. The bridge's `apply` handler shows the toast `Claude: <label>`, and only when the job actually changed.
5. **Live `save` without a path returns the tab's file name.** The browser never knows absolute paths. For a live session, `SessionInfo.path` is that file name, or null.
6. **Handshake:**
   - The tab sends a `hello` notification (`protocol`, `app`, `title`, `dirty`, `takeover`); the server answers with a `welcome` notification.
   - Refusals are WebSocket close codes with a reason: `4001` protocol mismatch, `4002` busy (`Another Spon tab is connected`), `4003` replaced (`Disconnected — another tab took over`).
   - A socket that sends no `hello` within 10 s is closed.
   - Only an explicit click sends `takeover: true`; automatic reconnects never do.
7. **After `4001` or `4003` the tab turns its bridge off** (and clears the remembered setting) and shows the reason. After `4002` it keeps retrying with backoff.
8. **The tab's port is overridable** with `localStorage['spon.bridge.port']`, read in try/catch. Playwright uses it for port 5196.
9. **The server exits when stdin ends.** A listening WebSocket server would otherwise keep the process alive after Claude Code closes the pipe.
10. **A live `import_model` adds a warning,** `Importing a model starts a new undo history in the tab`. This is spec §6.4's "the result says so".
11. **`run` in the tab** waits until `camStatus` is `idle` and the latest pipeline output matches the job's toolpath inputs (the same comparison that triggers regeneration). It fails with `Toolpath generation failed; see the tab` when generation ended in an error.

## Review Focus

1. **The user edits the job while Claude waits for `generate`.** `run` must answer for the job as it is when the answer is sent, never a stale run. → Task 6 test: an edit during generation makes `waitForCamRun` wait for the next run.
2. **Claude Code closes the server while the bridge is listening.** The process must exit instead of hanging on the open WebSocket server. → Task 5 test: spawn the bundle, end stdin, expect an exit within 10 s.
3. **A second Claude session starts while the first holds port 5197.** It must keep working headless, and `status` must say why live is unavailable. → Task 3 test (port in use) and Task 5 test (`use_live_tab` message, headless still works).
4. **A large STEP file over the bridge.** Base64 must handle multi-megabyte bytes without blowing the call stack, and `importModel` must get the 300 s timeout. → Task 1 test (3 MB round trip) and Task 3 test (the long timeout applies to `importModel` only).
5. **The tab closes in the middle of a request.** The tool returns `Tab disconnected`, the session becomes none, and headless tools keep working. → Task 3 test (pending request rejected) and Task 5 test (session cleared, `new_job` works afterwards).

---

## File map

**Core**
- `core/src/bridge/protocol.ts` (new): wire types, `BridgeMethods`, constants, `modelSummary`, `toBase64`/`fromBase64`.
- `core/src/pipeline/report.ts` (new): `RunReport`, `runReport`, `exportOutcome`.
- `core/src/pipeline/importOutcome.ts` (new): `decideImport`, `newModelRef`, `importedOutcome`, `operationsWithGeometry`.
- `core/src/job/commands.ts`: add `applyCommands`.
- `core/src/index.ts`: export the three new modules.
- `core/test/bridge-shared.test.ts` (new).

**MCP**
- `mcp/src/session.ts`: re-export the shared types; `run(): Promise<RunReport>`, `boxes(): Promise<Boxes>`.
- `mcp/src/fileSession.ts`: use `applyCommands`, `decideImport`, `runReport`, `exportOutcome`, `modelSummary`, `writeFileAtomic`.
- `mcp/src/files.ts` (new): `writeFileAtomic`, `withSponExtension`.
- `mcp/src/library.ts`: use `writeFileAtomic`.
- `mcp/src/state.ts`: new `NO_JOB`, `clear()`.
- `mcp/src/tools/output.ts`: `generate` reads the report.
- `mcp/src/tools/session.ts`: `statusText` for live sessions, `status` reports the bridge, `use_live_tab`.
- `mcp/src/live/connection.ts` (new): `TabConnection`, JSON-RPC to one tab.
- `mcp/src/live/bridge.ts` (new): `LiveBridge`, the WebSocket server, origins, handshake, takeover.
- `mcp/src/live/liveSession.ts` (new): `LiveSession implements JobSession`.
- `mcp/src/live/options.ts` (new): `bridgePort`, `allowedOrigins`.
- `mcp/src/context.ts`: `ServerDeps.bridge`; clear the session when its tab goes.
- `mcp/src/main.ts`: start the bridge, exit when stdin ends.
- `mcp/test/fakeTab.ts` (new): a Node `ws` tab, plus a handler that answers from a `FileSession`.
- `mcp/test/live-bridge.test.ts`, `mcp/test/live-session.test.ts`, `mcp/test/tools-live.test.ts`, `mcp/test/live-options.test.ts` (new).
- `mcp/package.json`, `mcp/README.md`, `THIRD_PARTY_NOTICES.md`.

**Web**
- `web/src/state/store.ts`: `dispatchBatch`.
- `web/src/state/cam.ts`: `camInputsChanged`, `ensureCamModel`, latest run, `waitForCamRun`, `camCatalog`, `camPreviewSvg`.
- `web/src/workers/import.worker.ts`, `web/src/workers/importClient.ts`: `catalog`, `previewSvg`.
- `web/src/state/documents.ts`: `importModelOutcome`, `saveToCurrentHandle`, `sponBytesForSave`, `markSavedIfCurrent`.
- `web/src/state/programs.ts`: `importProgramBytes` returns the new `ProgramRef`.
- `web/src/state/toolLibrary.ts`: `listLibraryTools`, `importLibraryBytes`.
- `web/src/bridge/status.ts` (new, eager): status store, settings, `setBridgeEnabled`, `resumeBridge`.
- `web/src/bridge/handlers.ts` (new, lazy): one handler per bridge method.
- `web/src/bridge/client.ts` (new, lazy): `BridgeClient`, `browserSocket`.
- `web/src/bridge/controller.ts` (new, lazy): wires the client to the store.
- `web/src/bridge/ClaudeStatus.tsx` (new): the status bar item.
- `web/src/layout/StatusBar.tsx`, `web/src/App.tsx`.
- Tests: `web/src/state/store.test.ts`, `web/src/state/cam.test.ts`, `web/src/state/documents-bridge.test.ts` (new), `web/src/state/toolLibrary.test.ts`, `web/src/bridge/handlers.test.ts`, `web/src/bridge/client.test.ts`, `web/src/bridge/status.test.ts` (new).
- `web/e2e/live.spec.ts` (new), `web/package.json`.

**Docs:** `.claude/skills/spon-dev/SKILL.md`, `packages/mcp/README.md`.

---

### Task 1: Core — shared bridge types, run report, batch commands, import decisions

**Files:**
- Create: `packages/core/src/bridge/protocol.ts`
- Create: `packages/core/src/pipeline/report.ts`
- Create: `packages/core/src/pipeline/importOutcome.ts`
- Modify: `packages/core/src/job/commands.ts` (add `applyCommands` after `applyCommand`)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/bridge-shared.test.ts`

**Interfaces:**
- Consumes: `CamRun`, `exportProblems`, `exportInputFromRun` (`pipeline/run.ts`, `pipeline/export.ts`); `ImportStep`, `defaultBody` (`pipeline/importFlow.ts`); `toModelGeometry`, `suggestedUnits`, `placementFor`, `ModelGeometry` (`pipeline/model.ts`); `applyCommand`, `CommandError`.
- Produces (all exported from `@sponcam/core`):
  - `BRIDGE_PROTOCOL = 1`, `DEFAULT_BRIDGE_PORT = 5197`, `BRIDGE_TIMEOUT_MS = 60_000`, `BRIDGE_IMPORT_TIMEOUT_MS = 300_000`, `BRIDGE_CLOSE = { protocolMismatch: 4001, busy: 4002, replaced: 4003 }`, `BUSY_MESSAGE`, `REPLACED_MESSAGE`
  - types `SessionInfo`, `SessionModel`, `ImportOutcome`, `ExportOutcome`, `LibraryImportResult`, `Boxes`, `HelloParams`, `WelcomeParams`, `JobChangedParams`, `BridgeMethods`, `BridgeMethod`, `BridgeParams<M>`, `BridgeResult<M>`
  - `modelSummary(model: ModelRef | null): SessionModel | null`
  - `toBase64(bytes: Uint8Array): string`, `fromBase64(text: string): Uint8Array`
  - `RunReport`, `ReportOperation`, `ReportFile`; `runReport(job: Job, run: CamRun): RunReport`; `exportOutcome(report: RunReport): ExportOutcome`
  - `applyCommands(job: Job, commands: readonly JobCommand[]): Job`
  - `ImportDecision`; `decideImport(step: ImportStep, units?: LengthUnit): ImportDecision`; `newModelRef(fileName: string, geometry: ModelGeometry, units: LengthUnit, blobId: string): NewModel`; `importedOutcome(job: Job, geometry: ModelGeometry, units: LengthUnit, warnings: readonly string[], affected: number): ImportOutcome`; `operationsWithGeometry(job: Job): number`

- [ ] **Step 1: Write the failing test**

`packages/core/test/bridge-shared.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyCommands, CommandError, createJob, decideImport, exportInputFromRun, exportOutcome, exportProblems, fromBase64, importedOutcome,
  importFile, type ImportStep, importStep, type Job, type JobCommand, modelSummary, newModelRef, operationsWithGeometry, PipelineCache, programContext,
  runPipeline, runReport, setModel, toBase64, toModelGeometry,
} from '../src';
import { tool6 } from './fixtures/camSetup';

const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

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

describe('runReport', () => {
  it('keeps what the tools read, as plain JSON', () => {
    const { job, geometry } = outlineJob();
    const { run } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' });
    const report = runReport(job, run);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.results).toEqual([{ operationId: 'p', diagnostics: run.results[0].diagnostics, heights: run.results[0].heights, hasToolpath: true }]);
    const summary = run.files[0].parsed.analysis.summary;
    expect(report.files[0]).toEqual({
      name: run.files[0].name, text: run.files[0].text, operationIds: ['p'], tools: run.files[0].tools,
      lineCount: summary.lineCount, seconds: summary.totalSeconds, extents: summary.extents,
    });
    expect(report.export).toEqual(exportProblems(exportInputFromRun(job, run)));
  });

  it('turns a report into an export outcome', () => {
    const files = [{ name: 'a.nc', text: 'G0 X0\n', operationIds: [], tools: [], lineCount: 1, seconds: 0, extents: null }];
    expect(exportOutcome({ results: [], files, export: { errors: [], warnings: ['w'] } })).toEqual({ ok: true, files: [{ name: 'a.nc', text: 'G0 X0\n' }], warnings: ['w'] });
    expect(exportOutcome({ results: [], files, export: { errors: ['e'], warnings: ['w'] } })).toEqual({ ok: false, errors: ['e'], warnings: ['w'] });
  });
});

describe('applyCommands', () => {
  it('applies every command, or none, naming the one that failed', () => {
    const job = createJob();
    const good: JobCommand = { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' };
    expect(applyCommands(job, [good]).operations.map((o) => o.id)).toEqual(['d']);
    const bad: JobCommand = { type: 'updateOperation', id: 'nope', patch: { name: 'x' } };
    expect(() => applyCommands(job, [good, bad])).toThrow(CommandError);
    expect(() => applyCommands(job, [good, bad])).toThrow('commands[1] updateOperation: No operation with id nope');
    expect(job.operations).toEqual([]);
  });
});

describe('import decisions', () => {
  const stlStep = (): ImportStep => importStep(importFile('part.stl', STL));

  it('asks for units when the file has none, with the raw size', () => {
    const d = decideImport(stlStep());
    if (d.status !== 'needsUnits') throw new Error(`expected needsUnits, got ${d.status}`);
    expect(['mm', 'in']).toContain(d.suggested);
    expect(d.rawSize).toEqual({ x: 2, y: 1, z: 0 });
  });

  it('is ready once units are given, and builds the model and the outcome', () => {
    const d = decideImport(stlStep(), 'mm');
    if (d.status !== 'ready') throw new Error(`expected ready, got ${d.status}`);
    const model = newModelRef('part.stl', d.geometry, d.units, 'b1');
    // only STEP/IGES results carry a source (format and body); an STL gives neither
    expect(model).toEqual({ sourceName: 'part.stl', blobId: 'b1', kind: 'mesh', importUnits: 'mm' });
    const job = setModel(applyCommands(createJob(), [{ type: 'addOperation', opType: 'drill', toolId: null, id: 'd' }]), model);
    const outcome = importedOutcome(job, d.geometry, 'mm', d.warnings, 2);
    expect(outcome).toEqual({
      status: 'imported', kind: 'mesh', size: { x: 2, y: 1, z: 0 }, units: 'mm',
      warnings: ['2 operation(s) referred to the previous model; their geometry no longer resolves'],
    });
  });

  it('passes errors and body choices on', () => {
    expect(decideImport({ kind: 'error', error: 'No solid bodies found' })).toEqual({ status: 'error', error: 'No solid bodies found' });
    const bodies = [{ name: 'small', triangles: 12, size: { x: 1, y: 1, z: 1 } }, { name: 'big', triangles: 12, size: { x: 5, y: 5, z: 5 } }];
    expect(decideImport({ kind: 'chooseBody', format: 'step', bodies })).toEqual({ status: 'needsBody', bodies, suggested: 1 });
  });

  it('counts the operations that have geometry', () => {
    const { job } = outlineJob();
    expect(operationsWithGeometry(job)).toBe(1);
    expect(operationsWithGeometry(createJob())).toBe(0);
  });
});

describe('wire helpers', () => {
  it('round-trips bytes through base64, including large files (review focus 4)', () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(fromBase64(toBase64(new Uint8Array()))).toEqual(new Uint8Array());
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('summarises the model of a job', () => {
    expect(modelSummary(null)).toBeNull();
    const job = setModel(createJob(), { sourceName: 'a.dxf', blobId: 'b', kind: 'drawing', importUnits: 'mm' });
    expect(modelSummary(job.model)).toEqual({ sourceName: 'a.dxf', kind: 'drawing', format: 'dxf', body: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test bridge-shared`
Expected: FAIL. The new exports (`applyCommands`, `runReport`, …) are not defined.

- [ ] **Step 3: Write the implementation**

`packages/core/src/bridge/protocol.ts`:

```ts
import type { GeometryCatalog } from '../cam/features/describe';
import type { BBox } from '../geometry/bbox';
import type { Vec3 } from '../geometry/vec3';
import type { CadBodySummary, ModelFormat, ModelKind } from '../import/importFile';
import type { JobCommand } from '../job/commands';
import type { Job, ModelRef, ProgramRef } from '../job/types';
import type { RunReport } from '../pipeline/report';
import type { PreviewOptions } from '../preview/svg';
import type { Tool } from '../tools/types';
import type { LengthUnit } from '../units/units';

/** The live bridge between the MCP server and one browser tab: JSON-RPC 2.0 over a WebSocket. */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_BRIDGE_PORT = 5197;
export const BRIDGE_TIMEOUT_MS = 60_000;
/** Large STEP files take a while to read. */
export const BRIDGE_IMPORT_TIMEOUT_MS = 300_000;
/** WebSocket close codes (4000–4999 are free for applications); the close reason is the message to show. */
export const BRIDGE_CLOSE = { protocolMismatch: 4001, busy: 4002, replaced: 4003 } as const;
export const BUSY_MESSAGE = 'Another Spon tab is connected';
export const REPLACED_MESSAGE = 'Disconnected — another tab took over';

export interface SessionModel { sourceName: string; kind: ModelKind; format: ModelFormat; body: number | null }

export interface SessionInfo {
  kind: 'file' | 'live';
  name: string;
  /** File session: the absolute .spon path. Live: the tab's file name. Null until opened or saved. */
  path: string | null;
  dirty: boolean;
  model: SessionModel | null;
  operations: number;
}

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

/** Placed model box and stock box in program coordinates. */
export interface Boxes { model: BBox | null; stock: BBox | null }

/** The tab's first message. `takeover` is true only for an explicit Connect click. */
export interface HelloParams { protocol: number; app: string; title: string; dirty: boolean; takeover: boolean }
export interface WelcomeParams { protocol: number; server: string }
/** Sent by the tab whenever its job name or dirty flag changes. */
export interface JobChangedParams { title: string; dirty: boolean }

type NoParams = Record<string, never>;

/** Requests the server sends to the tab. Bytes travel as base64 strings. */
export interface BridgeMethods {
  describe: { params: NoParams; result: SessionInfo };
  job: { params: NoParams; result: Job };
  /** Atomic, one undo step. */
  apply: { params: { commands: JobCommand[]; label: string }; result: Job };
  importModel: { params: { fileName: string; bytes: string; units?: LengthUnit; body?: number }; result: ImportOutcome };
  run: { params: NoParams; result: RunReport };
  catalog: { params: NoParams; result: GeometryCatalog | null };
  boxes: { params: NoParams; result: Boxes };
  previewSvg: { params: PreviewOptions; result: string };
  /** Saves through the tab's own file handle; returns the file name. */
  save: { params: NoParams; result: { name: string } };
  /** The job as .spon bytes, for the server to write; `token` goes back in markSaved. */
  saveBytes: { params: NoParams; result: { bytes: string; token: number } };
  /** Sent after the server wrote the saveBytes file; the tab clears its dirty flag if the job is unchanged. */
  markSaved: { params: { token: number }; result: { saved: boolean } };
  exportGcode: { params: NoParams; result: ExportOutcome };
  importProgram: { params: { fileName: string; bytes: string }; result: ProgramRef };
  'tools.list': { params: NoParams; result: Tool[] };
  'tools.add': { params: { tool: Tool }; result: NoParams };
  'tools.import': { params: { fileName: string; bytes: string }; result: LibraryImportResult };
}
export type BridgeMethod = keyof BridgeMethods;
export type BridgeParams<M extends BridgeMethod> = BridgeMethods[M]['params'];
export type BridgeResult<M extends BridgeMethod> = BridgeMethods[M]['result'];

export function modelSummary(model: ModelRef | null): SessionModel | null {
  if (!model) return null;
  return { sourceName: model.sourceName, kind: model.kind, format: model.format ?? (model.kind === 'mesh' ? 'stl' : 'dxf'), body: model.body ?? null };
}

/** Chunked, so multi-megabyte files never overflow the argument limit of String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

`packages/core/src/pipeline/report.ts`:

```ts
import type { ExportOutcome } from '../bridge/protocol';
import type { ResolvedHeights } from '../cam/heights';
import type { CamDiagnostic } from '../cam/types';
import type { BBox } from '../geometry/bbox';
import type { Job } from '../job/types';
import { exportInputFromRun, exportProblems } from './export';
import type { CamRun } from './run';

export interface ReportOperation { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; hasToolpath: boolean }
export interface ReportFile { name: string; text: string; operationIds: string[]; tools: number[]; lineCount: number; seconds: number; extents: BBox | null }
/** A CamRun without motion tables or overlays: plain JSON, so it can cross the live bridge. */
export interface RunReport { results: ReportOperation[]; files: ReportFile[]; export: { errors: string[]; warnings: string[] } }

export function runReport(job: Job, run: CamRun): RunReport {
  return {
    results: run.results.map(({ operationId, diagnostics, heights, hasToolpath }) => ({ operationId, diagnostics, heights, hasToolpath })),
    files: run.files.map((f) => {
      const { lineCount, totalSeconds, extents } = f.parsed.analysis.summary;
      return { name: f.name, text: f.text, operationIds: f.operationIds, tools: f.tools, lineCount, seconds: totalSeconds, extents };
    }),
    export: exportProblems(exportInputFromRun(job, run)),
  };
}

/** Errors block the export; warnings travel with the files. */
export function exportOutcome(report: RunReport): ExportOutcome {
  const { errors, warnings } = report.export;
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, files: report.files.map(({ name, text }) => ({ name, text })), warnings };
}
```

`packages/core/src/pipeline/importOutcome.ts`:

```ts
import type { ImportOutcome } from '../bridge/protocol';
import { bboxOfPoints, bboxSize } from '../geometry/bbox';
import { vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import type { NewModel } from '../job/update';
import type { LengthUnit } from '../units/units';
import { defaultBody, type ImportStep } from './importFlow';
import { type ModelGeometry, placementFor, suggestedUnits, toModelGeometry } from './model';

/** An import that can go ahead, or the outcome that tells the caller what is missing. */
export type ImportDecision =
  | { status: 'ready'; geometry: ModelGeometry; units: LengthUnit; warnings: string[] }
  | Exclude<ImportOutcome, { status: 'imported' }>;

/** Decides a reader result without asking anyone: the MCP server and the live bridge answer needsUnits / needsBody instead of opening a dialog. */
export function decideImport(step: ImportStep, units?: LengthUnit): ImportDecision {
  if (step.kind === 'error') return { status: 'error', error: step.error };
  if (step.kind === 'chooseBody') return { status: 'needsBody', bodies: step.bodies, suggested: defaultBody(step.bodies) };
  const geometry = toModelGeometry(step.result);
  const chosen = step.units ?? units;
  if (!chosen) {
    const raw = bboxOfPoints(geometry.rawPoints);
    return { status: 'needsUnits', suggested: suggestedUnits(step.result), rawSize: raw ? bboxSize(raw) : vec3(0, 0, 0) };
  }
  return { status: 'ready', geometry, units: chosen, warnings: [...step.result.warnings] };
}

export function newModelRef(fileName: string, geometry: ModelGeometry, units: LengthUnit, blobId: string): NewModel {
  const source = geometry.kind === 'mesh' ? geometry.source : undefined;
  return { sourceName: fileName, blobId, kind: geometry.kind, importUnits: units, ...(source ? { format: source.format, body: source.body } : {}) };
}

/** Operations that pick geometry; importing a new model breaks their references. */
export function operationsWithGeometry(job: Job): number {
  return job.operations.filter((op) => op.geometry.length > 0).length;
}

/** The `imported` outcome for `job` after its model was set from `geometry`; `affected` comes from operationsWithGeometry before the import. */
export function importedOutcome(job: Job, geometry: ModelGeometry, units: LengthUnit, warnings: readonly string[], affected: number): ImportOutcome {
  const placement = job.model ? placementFor(job.model, geometry) : null;
  const all = [...warnings];
  if (affected) all.push(`${affected} operation(s) referred to the previous model; their geometry no longer resolves`);
  return { status: 'imported', kind: geometry.kind, size: placement ? bboxSize(placement.bbox) : vec3(0, 0, 0), units, warnings: all };
}
```

In `packages/core/src/job/commands.ts`, directly after `applyCommand`:

```ts
/** Applies commands in order, all or none; a failure names the command: `commands[2] updateOperation: …`. */
export function applyCommands(job: Job, commands: readonly JobCommand[]): Job {
  let next = job;
  commands.forEach((c, i) => {
    try {
      next = applyCommand(next, c);
    } catch (err) {
      throw new CommandError(`commands[${i}] ${c.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return next;
}
```

Append to `packages/core/src/index.ts`:

```ts
export * from './pipeline/report';
export * from './pipeline/importOutcome';
export * from './bridge/protocol';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test bridge-shared`
Expected: PASS (8 tests).
Run: `pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bridge packages/core/src/pipeline/report.ts packages/core/src/pipeline/importOutcome.ts packages/core/src/job/commands.ts packages/core/src/index.ts packages/core/test/bridge-shared.test.ts
git commit -m "feat(core): bridge wire types, JSON run report, batch commands and import decisions"
```

---

### Task 2: MCP — sessions on the shared core pieces; `run()` returns a `RunReport`

**Files:**
- Create: `packages/mcp/src/files.ts`
- Modify: `packages/mcp/src/session.ts`
- Modify: `packages/mcp/src/fileSession.ts`
- Modify: `packages/mcp/src/library.ts` (`write` uses `writeFileAtomic`)
- Modify: `packages/mcp/src/state.ts`
- Modify: `packages/mcp/src/tools/output.ts` (`generate`)
- Modify: `packages/mcp/src/tools/session.ts` (`statusText`)
- Test: `packages/mcp/test/tools-session.test.ts`, `packages/mcp/test/fileSession.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `writeFileAtomic(file: string, data: Uint8Array | string): Promise<void>` (throws the raw fs error after removing the temporary file); `withSponExtension(path: string): string`
  - `JobSession.run(): Promise<RunReport>`, `JobSession.boxes(): Promise<Boxes>`; `session.ts` re-exports `SessionInfo`, `ImportOutcome`, `ExportOutcome`, `LibraryImportResult`, `Boxes` from core
  - `NO_JOB = 'No job open. Use new_job, open_job or use_live_tab.'`; `ServerState.clear(): void`
  - `statusText(info: SessionInfo): string`: live sessions read `Live tab: job "<name>"…`

- [ ] **Step 1: Write the failing tests**

In `packages/mcp/test/tools-session.test.ts`, change both expectations of `'No job open. Use new_job or open_job.'` to `'No job open. Use new_job, open_job or use_live_tab.'`. Then add this test to the `describe('session tools')` block:

```ts
  it('describes a live session by its tab', async () => {
    const { statusText } = await import('../src/tools/session');
    expect(statusText({ kind: 'live', name: 'Bracket', path: 'bracket.spon', dirty: true, model: null, operations: 2 }))
      .toBe('Live tab: job "Bracket" (bracket.spon), unsaved changes. Model: none. Operations: 2.');
    expect(statusText({ kind: 'live', name: 'New', path: null, dirty: false, model: null, operations: 0 }))
      .toBe('Live tab: job "New" (no file yet). Model: none. Operations: 0.');
  });
```

In `packages/mcp/test/fileSession.test.ts`, add:

```ts
  it('reports the run as JSON with line counts and the export verdict', async () => {
    const s = await profiledDxf();
    const report = await s.run();
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.files[0].lineCount).toBeGreaterThan(5);
    expect(report.files[0].seconds).toBeGreaterThan(0);
    expect(report.export.errors).toEqual([]);
    expect(await s.run()).toBe(report); // cached until the job changes
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test tools-session fileSession`
Expected: FAIL. The `NO_JOB` text differs, `statusText` has no live wording, and `lineCount` is undefined on the run.

- [ ] **Step 3: Write the implementation**

`packages/mcp/src/files.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { SPON_EXTENSION } from '@sponcam/core';

/** Writes a temporary file and renames it over `file`, so a failed write never leaves half a file. Throws the fs error. */
export async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function withSponExtension(path: string): string {
  return extname(path).toLowerCase() === SPON_EXTENSION ? path : `${path}${SPON_EXTENSION}`;
}
```

`packages/mcp/src/session.ts`: replace the local `SessionInfo`, `ImportOutcome`, `ExportOutcome` and `LibraryImportResult` declarations with re-exports, and change `run`/`boxes`:

```ts
import type { Boxes, GeometryCatalog, Job, JobCommand, LengthUnit, LibraryImportResult, ExportOutcome, ImportOutcome, PreviewOptions, ProgramRef, RunReport, SessionInfo, Tool } from '@sponcam/core';

export type { Boxes, ExportOutcome, ImportOutcome, LibraryImportResult, SessionInfo } from '@sponcam/core';
```

Keep `SessionError`, `ModelInput`, `ToolLibraryAccess` and `JobSession` as they are, except:

```ts
  /** Pipeline output for the current job, as plain JSON; cached per job version. */
  run(): Promise<RunReport>;
  catalog(): Promise<GeometryCatalog | null>;
  /** Placed model box and stock box in program coordinates. */
  boxes(): Promise<Boxes>;
```

Also update the `JobSession` doc comment to "One open job: a .spon file on disk (FileSession) or the browser tab (LiveSession)."

`packages/mcp/src/fileSession.ts` changes:
- Imports: add `applyCommands`, `decideImport`, `exportOutcome`, `importedOutcome`, `modelSummary`, `newModelRef`, `operationsWithGeometry`, `type RunReport`, `runReport` and `type Boxes`. Drop `applyCommand`, `bboxOfPoints`, `bboxSize`, `CommandError`, `defaultBody`, `exportInputFromRun`, `exportProblems`, `placementFor`, `setModel` only where they are no longer used (keep `setModel`), plus `suggestedUnits`, `toModelGeometry` if unused, `vec3`, `SPON_EXTENSION`, `extname`, `randomBytes`, `rename`, `rm` and `writeFile`.
- `last` becomes `{ job: Job; geometry: ModelGeometry | null; result: PipelineResult; report: RunReport } | null`, and `pipeline()` builds `report: runReport(this.current, result.run)` together with the result.
- Replace the methods:

```ts
  async describe(): Promise<SessionInfo> {
    return { kind: 'file', name: this.current.name, path: this.path, dirty: this.dirty, model: modelSummary(this.current.model), operations: this.current.operations.length };
  }

  async apply(commands: readonly JobCommand[]): Promise<Job> {
    const next = applyCommands(this.current, commands);
    if (next !== this.current) {
      this.current = next;
      this.dirty = true;
    }
    return this.current;
  }

  async importModel(input: ModelInput): Promise<ImportOutcome> {
    const step = importStep(await importModel(input.fileName, input.bytes, input.body, this.options.loadReader));
    const decision = decideImport(step, input.units);
    if (decision.status !== 'ready') return decision;
    const affected = operationsWithGeometry(this.current);
    const blobId = crypto.randomUUID();
    const oldBlob = this.current.model?.blobId;
    this.current = setModel(this.current, newModelRef(input.fileName, decision.geometry, decision.units, blobId));
    this.blobs = { ...Object.fromEntries(Object.entries(this.blobs).filter(([id]) => id !== oldBlob)), [blobId]: input.bytes };
    this.geometry = decision.geometry;
    this.dirty = true;
    return importedOutcome(this.current, decision.geometry, decision.units, decision.warnings, affected);
  }

  private pipeline(): { result: PipelineResult; report: RunReport } {
    if (this.last && this.last.job === this.current && this.last.geometry === this.geometry) return this.last;
    const opts = this.options.postDate ? { date: this.options.postDate } : {};
    const result = runPipeline(this.current, this.geometry, programContext(this.current, this.geometry), this.cache, opts);
    this.last = { job: this.current, geometry: this.geometry, result, report: runReport(this.current, result.run) };
    return this.last;
  }

  async run(): Promise<RunReport> {
    return this.pipeline().report;
  }

  async boxes(): Promise<Boxes> {
    const ctx = camContext(this.current, this.geometry);
    return { model: ctx.model, stock: ctx.stock };
  }

  async previewSvg(options: PreviewOptions): Promise<string> {
    return renderPreviewSvg(previewInput(this.current, this.geometry, this.pipeline().result), options);
  }

  async save(path?: string): Promise<string> {
    const target = path ?? this.path;
    if (!target) throw new SessionError('This job has not been saved yet — give a path');
    const file = withSponExtension(target);
    try {
      await writeFileAtomic(file, writeSpon(this.current, this.blobs));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    this.path = file;
    this.dirty = false;
    return file;
  }

  async exportGcode(): Promise<ExportOutcome> {
    return exportOutcome(this.pipeline().report);
  }
```

`FileSession.apply` previously wrapped `applyCommand` errors itself. `applyCommands` now throws the same `commands[i] type: …` `CommandError`, and the existing atomic-batch test checks that text.

`packages/mcp/src/library.ts`: `write` becomes:

```ts
  private async write(tools: readonly Tool[]): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFileAtomic(this.path, exportToolLibrary(tools));
    } catch (err) {
      throw new SessionError(`Could not write the tool library ${this.path}: ${message(err)}`);
    }
  }
```

Drop the now-unused imports (`randomBytes`, `rename`, `rm`, `writeFile`). Import `writeFileAtomic` from `./files`.

`packages/mcp/src/state.ts`:

```ts
export const NO_JOB = 'No job open. Use new_job, open_job or use_live_tab.';
```

and add to `ServerState`:

```ts
  /** No current session (the live tab went away). */
  clear(): void {
    this.session = null;
    this.handles.clear();
  }
```

`packages/mcp/src/tools/session.ts`, `statusText`:

```ts
export function statusText(info: SessionInfo): string {
  const model = info.model ? `${info.model.sourceName} (${info.model.format}${info.model.body !== null ? `, body ${info.model.body}` : ''})` : 'none';
  const head = info.kind === 'live'
    ? `Live tab: job "${info.name}" (${info.path ?? 'no file yet'})`
    : `Job "${info.name}" (${info.path ?? 'not saved yet'})`;
  return `${head}${info.dirty ? ', unsaved changes' : ''}. Model: ${model}. Operations: ${info.operations}.`;
}
```

`packages/mcp/src/tools/output.ts`, `generate`: read the report instead of the parsed programs. Remove the `exportInputFromRun, exportProblems` imports.

```ts
    const files = run.files.map((f) => ({ name: f.name, lines: f.lineCount, tools: f.tools, seconds: f.seconds }));
    const cycleSeconds = files.reduce((t, f) => t + f.seconds, 0);
    let extents: BBox | null = null;
    for (const f of run.files) if (f.extents) extents = union(extents, f.extents);
    const verdict = run.export;
```

Everything else in `generate`, `get_gcode` and the resources stays: they only read `results`, `files[].name` and `files[].text`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp typecheck && pnpm --filter @sponcam/mcp test`
Expected: PASS. All phase 1 tests still pass, plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src packages/mcp/test
git commit -m "refactor(mcp): sessions return a JSON run report and share import, batch and save helpers with core"
```

---

### Task 3: MCP — `LiveBridge` and `TabConnection`

**Files:**
- Modify: `packages/mcp/package.json` (add `"ws": "^8.18.0"` to `dependencies` and `"@types/ws": "^8.18.0"` to `devDependencies`, then run `pnpm install`)
- Create: `packages/mcp/src/live/connection.ts`
- Create: `packages/mcp/src/live/bridge.ts`
- Create: `packages/mcp/test/fakeTab.ts`
- Test: `packages/mcp/test/live-bridge.test.ts`

**Interfaces:**
- Consumes: `BRIDGE_PROTOCOL`, `BRIDGE_CLOSE`, `BRIDGE_TIMEOUT_MS`, `BRIDGE_IMPORT_TIMEOUT_MS`, `BUSY_MESSAGE`, `REPLACED_MESSAGE`, `HelloParams`, `JobChangedParams`, `BridgeMethod`, `BridgeParams`, `BridgeResult` (core); `SessionError` (`../session`); `log`, `debugLog`.
- Produces:
  - `interface Timeouts { normal: number; long: number }`
  - `class TabConnection { title: string; dirty: boolean; readonly open: boolean; request<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>>; notify(method: string, params: unknown): void; onClose(listener: () => void): void; close(code: number, reason: string): void }`
  - `DEFAULT_ORIGINS: string[]`
  - `interface BridgeOptions { port: number; allowedOrigins?: readonly string[]; timeouts?: Timeouts; serverVersion: string; helloTimeoutMs?: number }`
  - `type BridgeState = { status: 'starting' } | { status: 'listening'; port: number } | { status: 'unavailable'; reason: string } | { status: 'closed' }`
  - `class LiveBridge { state: BridgeState; tab: TabConnection | null; start(): Promise<BridgeState>; describe(): string; onTabGone(listener: (tab: TabConnection) => void): void; close(): Promise<void> }`
  - test helpers `openTab(port: number, options?: FakeTabOptions): FakeTab` (synchronous; await its `opened`/`welcomed`/`closed` promises) and `sessionHandler(session)`; `sessionHandler` is added in Task 4.

- [ ] **Step 1: Write the fake tab helper**

`packages/mcp/test/fakeTab.ts`:

```ts
import { BRIDGE_PROTOCOL } from '@sponcam/core';
import { WebSocket } from 'ws';

export type Handle = (method: string, params: any) => unknown;

export interface FakeTabOptions {
  /** null: send no Origin header. Default http://localhost:5173. */
  origin?: string | null;
  protocol?: number;
  takeover?: boolean;
  title?: string;
  handle?: Handle;
}

export interface FakeTab {
  socket: WebSocket;
  /** true once the WebSocket opened, false if the handshake was refused. */
  opened: Promise<boolean>;
  /** Resolves on the server's welcome. */
  welcomed: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  methods: string[];
  send(message: unknown): void;
}

/** A browser tab, played by a Node WebSocket: says hello, answers requests with `handle`, replies with JSON-RPC errors when it throws. */
export function openTab(port: number, options: FakeTabOptions = {}): FakeTab {
  const origin = options.origin === undefined ? 'http://localhost:5173' : options.origin;
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin === null ? {} : { origin });
  const methods: string[] = [];
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  let welcome!: () => void;
  const welcomed = new Promise<void>((resolve) => { welcome = resolve; });
  const opened = new Promise<boolean>((resolve) => {
    socket.once('open', () => resolve(true));
    socket.once('error', () => resolve(false));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  socket.on('open', () => send({
    jsonrpc: '2.0', method: 'hello',
    params: { protocol: options.protocol ?? BRIDGE_PROTOCOL, app: 'fake-tab', title: options.title ?? 'Tab job', dirty: false, takeover: options.takeover ?? false },
  }));
  socket.on('message', async (data) => {
    const msg = JSON.parse(String(data));
    if (msg.method === 'welcome') return welcome();
    if (msg.id === undefined || !msg.method) return;
    methods.push(msg.method);
    try {
      const result = await (options.handle ?? (() => ({})))(msg.method, msg.params);
      send({ jsonrpc: '2.0', id: msg.id, result: result ?? {} });
    } catch (err) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } });
    }
  });
  return { socket, opened, welcomed, closed, methods, send };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/mcp/test/live-bridge.test.ts`:

```ts
import { BRIDGE_CLOSE, REPLACED_MESSAGE } from '@sponcam/core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS, LiveBridge } from '../src/live/bridge';
import { openTab } from './fakeTab';

const bridges: LiveBridge[] = [];
async function started(options: Partial<ConstructorParameters<typeof LiveBridge>[0]> = {}) {
  const bridge = new LiveBridge({ port: 0, serverVersion: 'test', ...options });
  bridges.push(bridge);
  const state = await bridge.start();
  if (state.status !== 'listening') throw new Error(`bridge did not start: ${JSON.stringify(state)}`);
  return { bridge, port: state.port };
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

describe('LiveBridge', () => {
  it('allows the dev, preview and test origins by default', () => {
    expect(DEFAULT_ORIGINS).toEqual(expect.arrayContaining(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://localhost:5198', 'http://127.0.0.1:5199']));
  });

  it('refuses unknown and missing origins, accepts allowed and extra ones', async () => {
    const { port } = await started({ allowedOrigins: [...DEFAULT_ORIGINS, 'http://spon.local:8080'] });
    expect(await openTab(port, { origin: 'http://evil.example' }).opened).toBe(false);
    expect(await openTab(port, { origin: null }).opened).toBe(false);
    const extra = openTab(port, { origin: 'http://spon.local:8080' });
    await extra.welcomed;
    extra.socket.close();
  });

  it('closes a tab that speaks another protocol', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { protocol: 2 });
    const { code, reason } = await tab.closed;
    expect(code).toBe(BRIDGE_CLOSE.protocolMismatch);
    expect(reason).toContain('protocol');
    expect(bridge.tab).toBeNull();
  });

  it('keeps the first tab unless the second one takes over', async () => {
    const { bridge, port } = await started();
    const gone: unknown[] = [];
    bridge.onTabGone((t) => gone.push(t));
    const first = openTab(port, { title: 'First' });
    await first.welcomed;
    const auto = openTab(port);
    expect(await auto.closed).toEqual({ code: BRIDGE_CLOSE.busy, reason: 'Another Spon tab is connected' });
    expect(bridge.tab?.title).toBe('First');
    const firstTab = bridge.tab;
    const second = openTab(port, { takeover: true, title: 'Second' });
    await second.welcomed;
    expect(await first.closed).toEqual({ code: BRIDGE_CLOSE.replaced, reason: REPLACED_MESSAGE });
    expect(bridge.tab?.title).toBe('Second');
    expect(gone).toEqual([firstTab]);
  });

  it('sends requests and settles them with results and errors', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, {
      handle: (method, params) => {
        if (method === 'apply') throw new Error('commands[0] updateOperation: No operation with id nope');
        return { echo: method, params };
      },
    });
    await tab.welcomed;
    expect(await bridge.tab!.request('describe', {})).toEqual({ echo: 'describe', params: {} });
    await expect(bridge.tab!.request('apply', { commands: [], label: 'x' })).rejects.toThrow('commands[0] updateOperation: No operation with id nope');
  });

  it('times out a silent tab, with the long timeout for importModel only (review focus 4)', async () => {
    const { bridge, port } = await started({ timeouts: { normal: 50, long: 400 } });
    const tab = openTab(port, { handle: () => new Promise(() => {}) });
    await tab.welcomed;
    await expect(bridge.tab!.request('job', {})).rejects.toThrow('The tab did not answer within 0.05 s');
    const started_ = Date.now();
    await expect(bridge.tab!.request('importModel', { fileName: 'a.stl', bytes: '' })).rejects.toThrow('The tab did not answer within 0.4 s');
    expect(Date.now() - started_).toBeGreaterThanOrEqual(350);
  });

  it('fails a pending request when the tab disconnects (review focus 5)', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { handle: () => new Promise(() => {}) });
    await tab.welcomed;
    const pending = bridge.tab!.request('run', {});
    tab.socket.terminate();
    await expect(pending).rejects.toThrow('Tab disconnected');
    await until(() => bridge.tab === null);
  });

  it('tracks the tab title and dirty flag', async () => {
    const { bridge, port } = await started();
    const tab = openTab(port, { title: 'Before' });
    await tab.welcomed;
    tab.send({ jsonrpc: '2.0', method: 'jobChanged', params: { title: 'After', dirty: true } });
    await until(() => bridge.tab?.title === 'After');
    expect(bridge.tab!.dirty).toBe(true);
  });

  it('reports a port in use and keeps running without live (review focus 3)', async () => {
    const { port } = await started();
    const second = new LiveBridge({ port, serverVersion: 'test' });
    bridges.push(second);
    expect(await second.start()).toEqual({ status: 'unavailable', reason: `port ${port} in use` });
    expect(second.describe()).toBe(`live bridge unavailable: port ${port} in use`);
  });

  it('closes a socket that never says hello', async () => {
    const { port } = await started({ helloTimeoutMs: 50 });
    const { WebSocket } = await import('ws');
    const silent = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' });
    const code = await new Promise<number>((resolve) => silent.once('close', (c) => resolve(c)));
    expect(code).toBe(1008);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test live-bridge`
Expected: FAIL. `../src/live/bridge` does not exist.

- [ ] **Step 4: Write the implementation**

`packages/mcp/src/live/connection.ts`:

```ts
import {
  BRIDGE_IMPORT_TIMEOUT_MS, BRIDGE_TIMEOUT_MS, type BridgeMethod, type BridgeParams, type BridgeResult, type HelloParams, type JobChangedParams,
} from '@sponcam/core';
import type { WebSocket } from 'ws';
import { debugLog } from '../log';
import { SessionError } from '../session';

export interface Timeouts { normal: number; long: number }
export const DEFAULT_TIMEOUTS: Timeouts = { normal: BRIDGE_TIMEOUT_MS, long: BRIDGE_IMPORT_TIMEOUT_MS };

interface Pending { resolve(value: unknown): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> }

/** One connected tab: JSON-RPC requests out, responses and jobChanged notifications in. */
export class TabConnection {
  title: string;
  dirty: boolean;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closedReason: string | null = null;
  private readonly closeListeners: (() => void)[] = [];

  constructor(private readonly socket: WebSocket, hello: HelloParams, private readonly timeouts: Timeouts = DEFAULT_TIMEOUTS) {
    this.title = hello.title;
    this.dirty = hello.dirty;
    socket.on('message', (data) => this.receive(String(data)));
    socket.on('close', () => this.closed('Tab disconnected'));
    socket.on('error', (err) => debugLog(`tab socket error: ${err.message}`));
  }

  get open(): boolean {
    return this.closedReason === null;
  }

  request<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>> {
    if (this.closedReason) return Promise.reject(new SessionError(this.closedReason));
    const id = this.nextId++;
    const ms = method === 'importModel' ? this.timeouts.long : this.timeouts.normal;
    debugLog(`→ tab ${method} #${id}`);
    return new Promise<BridgeResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SessionError(`The tab did not answer within ${ms / 1000} s`));
      }, ms);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    if (this.open) this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
    this.closed('Tab disconnected');
  }

  private receive(text: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(text);
    } catch {
      debugLog('tab sent a message that is not JSON');
      return;
    }
    if (typeof msg.id === 'number' && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new SessionError(msg.error.message ?? 'The tab reported an error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'jobChanged') {
      const { title, dirty } = msg.params as JobChangedParams;
      this.title = title;
      this.dirty = dirty;
    }
  }

  private closed(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new SessionError(reason));
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }
}
```

`packages/mcp/src/live/bridge.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { BRIDGE_CLOSE, BRIDGE_PROTOCOL, BUSY_MESSAGE, type HelloParams, REPLACED_MESSAGE } from '@sponcam/core';
import { type WebSocket, WebSocketServer } from 'ws';
import { log } from '../log';
import { DEFAULT_TIMEOUTS, TabConnection, type Timeouts } from './connection';

export const DEFAULT_ORIGINS: string[] = [5173, 4173, 5198, 5199].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);

export interface BridgeOptions {
  port: number;
  allowedOrigins?: readonly string[];
  timeouts?: Timeouts;
  serverVersion: string;
  helloTimeoutMs?: number;
}

export type BridgeState =
  | { status: 'starting' }
  | { status: 'listening'; port: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'closed' };

/** The WebSocket server the browser tab connects to: loopback only, allowed origins only, one tab at a time. */
export class LiveBridge {
  state: BridgeState = { status: 'starting' };
  tab: TabConnection | null = null;
  private server: WebSocketServer | null = null;
  private readonly origins: Set<string>;
  private readonly goneListeners: ((tab: TabConnection) => void)[] = [];

  constructor(private readonly options: BridgeOptions) {
    this.origins = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  }

  start(): Promise<BridgeState> {
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1', port: this.options.port,
        // browsers always send a truthful Origin; no Origin means a non-browser client, which is refused too
        verifyClient: (info: { origin?: string }) => info.origin !== undefined && this.origins.has(info.origin),
      });
      server.once('listening', () => {
        this.server = server;
        this.state = { status: 'listening', port: (server.address() as AddressInfo).port };
        server.on('error', (err) => log(`live bridge error: ${err.message}`));
        log(`live bridge listening on ws://127.0.0.1:${this.state.port}`);
        resolve(this.state);
      });
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (this.state.status !== 'starting') return;
        const reason = err.code === 'EADDRINUSE' ? `port ${this.options.port} in use` : err.message;
        this.state = { status: 'unavailable', reason };
        log(`live bridge unavailable: ${reason}`);
        server.close();
        resolve(this.state);
      });
      server.on('connection', (socket) => this.accept(socket));
    });
  }

  describe(): string {
    switch (this.state.status) {
      case 'listening': return `listening on ws://127.0.0.1:${this.state.port}`;
      case 'unavailable': return `live bridge unavailable: ${this.state.reason}`;
      default: return `live bridge ${this.state.status}`;
    }
  }

  /** Called when a tab's connection ends (closed, lost or replaced). */
  onTabGone(listener: (tab: TabConnection) => void): void {
    this.goneListeners.push(listener);
  }

  async close(): Promise<void> {
    this.tab?.close(1001, 'Server closing');
    const server = this.server;
    this.server = null;
    this.state = { status: 'closed' };
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private accept(socket: WebSocket): void {
    const timer = setTimeout(() => socket.close(1008, 'Expected hello'), this.options.helloTimeoutMs ?? 10_000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      let hello: HelloParams | null = null;
      try {
        const msg = JSON.parse(String(data));
        if (msg.method === 'hello') hello = msg.params as HelloParams;
      } catch {
        // not JSON: refused below
      }
      if (!hello) {
        socket.close(1008, 'Expected hello');
        return;
      }
      if (hello.protocol !== BRIDGE_PROTOCOL) {
        log(`refused a tab speaking bridge protocol ${hello.protocol} (this server speaks ${BRIDGE_PROTOCOL})`);
        socket.close(BRIDGE_CLOSE.protocolMismatch, `Bridge protocol mismatch: server ${BRIDGE_PROTOCOL}, tab ${hello.protocol}. Reload the tab or update the server.`);
        return;
      }
      if (this.tab?.open && !hello.takeover) {
        socket.close(BRIDGE_CLOSE.busy, BUSY_MESSAGE);
        return;
      }
      const previous = this.tab;
      const tab = new TabConnection(socket, hello, this.options.timeouts ?? DEFAULT_TIMEOUTS);
      this.tab = tab;
      tab.onClose(() => {
        if (this.tab === tab) this.tab = null;
        for (const listener of this.goneListeners) listener(tab);
      });
      previous?.close(BRIDGE_CLOSE.replaced, REPLACED_MESSAGE);
      tab.notify('welcome', { protocol: BRIDGE_PROTOCOL, server: this.options.serverVersion });
      log(`tab connected: "${hello.title}"`);
    });
  }
}
```

The order matters. The new tab is stored before the previous one is closed, so the previous tab's `onClose` sees `this.tab !== previous` and does not clear the slot. The gone-listeners still fire for the previous tab, which is what clears a `LiveSession` bound to it (Task 5).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp test live-bridge`
Expected: PASS (10 tests).
Run: `pnpm --filter @sponcam/mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/package.json pnpm-lock.yaml packages/mcp/src/live packages/mcp/test/fakeTab.ts packages/mcp/test/live-bridge.test.ts
git commit -m "feat(mcp): live bridge WebSocket server with origin allow-list, handshake, takeover and request timeouts"
```

---

### Task 4: MCP — `LiveSession`

**Files:**
- Create: `packages/mcp/src/live/liveSession.ts`
- Modify: `packages/mcp/test/fakeTab.ts` (add `sessionHandler`)
- Test: `packages/mcp/test/live-session.test.ts`

**Interfaces:**
- Consumes: `TabConnection` (Task 3); `JobSession`, `ModelInput`, `ToolLibraryAccess`, `SessionError` (`../session`); `writeFileAtomic`, `withSponExtension` (Task 2); `toBase64`, `fromBase64` (core).
- Produces: `class LiveSession implements JobSession { readonly kind: 'live'; readonly tab: TabConnection; … }`. `save()` without a path returns the tab's file name; with a path it writes the `.spon` atomically and returns the absolute path. Also the test helper `sessionHandler(session: FileSession): { handle: Handle; marked: number[] }`.

- [ ] **Step 1: Add the session-backed tab handler to the test helpers**

Append to `packages/mcp/test/fakeTab.ts`:

```ts
import { fromBase64, toBase64 } from '@sponcam/core';
import type { FileSession } from '../src/fileSession';

/** Answers bridge requests from a FileSession, so tests drive the whole wire path against real CAM results. */
export function sessionHandler(session: FileSession): { handle: Handle; marked: number[] } {
  const marked: number[] = [];
  const handle: Handle = async (method, p) => {
    switch (method) {
      case 'describe': return { ...(await session.describe()), kind: 'live' };
      case 'job': return session.job();
      case 'apply': return session.apply(p.commands, p.label);
      case 'importModel': return session.importModel({ fileName: p.fileName, bytes: fromBase64(p.bytes), units: p.units, body: p.body });
      case 'run': return session.run();
      case 'catalog': return session.catalog();
      case 'boxes': return session.boxes();
      case 'previewSvg': return session.previewSvg(p);
      case 'save': throw new Error('This tab has no file yet — give a path');
      case 'saveBytes': return { bytes: toBase64(new TextEncoder().encode('spon bytes')), token: 7 };
      case 'markSaved': marked.push(p.token); return { saved: true };
      case 'exportGcode': return session.exportGcode();
      case 'importProgram': return session.importProgram(p.fileName, fromBase64(p.bytes));
      case 'tools.list': return session.tools.list();
      case 'tools.add': await session.tools.add(p.tool); return {};
      case 'tools.import': return session.tools.importFile(p.fileName, fromBase64(p.bytes));
      default: throw new Error(`Unknown method ${method}`);
    }
  };
  return { handle, marked };
}
```

Move the new imports to the top of the file with the existing ones.

- [ ] **Step 2: Write the failing tests**

`packages/mcp/test/live-session.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeometryRef, JobCommand } from '@sponcam/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSession } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { LiveBridge } from '../src/live/bridge';
import { LiveSession } from '../src/live/liveSession';
import { loadNodeOcct } from '../src/occt';
import { openTab, sessionHandler } from './fakeTab';
import { fixture, tempDir, tool6 } from './helpers';

const bridges: LiveBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

async function live() {
  const backing = FileSession.create({ name: 'Tab job' }, { library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });
  const bridge = new LiveBridge({ port: 0, serverVersion: 'test' });
  bridges.push(bridge);
  const state = await bridge.start();
  if (state.status !== 'listening') throw new Error('bridge did not start');
  const { handle, marked } = sessionHandler(backing);
  const tab = openTab(state.port, { handle });
  await tab.welcomed;
  return { session: new LiveSession(bridge.tab!), backing, tab, marked };
}

describe('LiveSession', () => {
  it('drives the tab: import, apply, run, catalog, boxes, preview and export', async () => {
    const { session, backing, tab } = await live();
    expect(session.kind).toBe('live');
    expect((await session.describe()).kind).toBe('live');
    expect((await session.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') })).status).toBe('imported');
    const outline = (await session.catalog())!.contours.find((c) => c.layer === 'OUTLINE')!.ref as GeometryRef;
    const commands: JobCommand[] = [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
      { type: 'updateOperation', id: 'p', patch: { geometry: [outline] } },
    ];
    const job = await session.apply(commands, 'Add Profile on C1');
    expect(job.operations.map((o) => o.id)).toEqual(['p']);
    expect(await session.run()).toEqual(await backing.run());
    expect((await session.boxes()).stock).not.toBeNull();
    expect(await session.previewSvg({ view: 'top', operations: ['p'] })).toContain('<svg');
    const exported = await session.exportGcode();
    expect(exported.ok).toBe(true);
    expect(tab.methods).toEqual(expect.arrayContaining(['importModel', 'apply', 'run', 'catalog', 'boxes', 'previewSvg', 'exportGcode']));
  });

  it('passes the tab\'s command errors on', async () => {
    const { session } = await live();
    await expect(session.apply([{ type: 'updateOperation', id: 'nope', patch: { name: 'x' } }])).rejects.toThrow('commands[0] updateOperation: No operation with id nope');
  });

  it('saves to a path on disk, then tells the tab it is saved', async () => {
    const { session, marked } = await live();
    const dir = tempDir();
    const path = await session.save(join(dir, 'tab-job'));
    expect(path).toBe(join(dir, 'tab-job.spon'));
    expect(readFileSync(path, 'utf8')).toBe('spon bytes');
    expect(marked).toEqual([7]);
    await expect(session.save()).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('reaches the tab\'s tool library and programs', async () => {
    const { session } = await live();
    await session.tools.add(tool6);
    expect((await session.tools.list()).some((t) => t.id === 't6')).toBe(true);
    expect((await session.importProgram('drill-arc.nc', fixture('drill-arc.nc'))).name).toBe('drill-arc.nc');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test live-session`
Expected: FAIL. `../src/live/liveSession` does not exist.

- [ ] **Step 4: Write the implementation**

`packages/mcp/src/live/liveSession.ts`:

```ts
import {
  type Boxes, type ExportOutcome, fromBase64, type GeometryCatalog, type ImportOutcome, type Job, type JobCommand, type PreviewOptions, type ProgramRef,
  type RunReport, type SessionInfo, toBase64,
} from '@sponcam/core';
import { withSponExtension, writeFileAtomic } from '../files';
import { type JobSession, type ModelInput, SessionError, type ToolLibraryAccess } from '../session';
import type { TabConnection } from './connection';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The job open in the browser tab. Every call is a request to the tab; each apply is one undo step there. */
export class LiveSession implements JobSession {
  readonly kind = 'live' as const;
  readonly tools: ToolLibraryAccess;

  constructor(readonly tab: TabConnection) {
    this.tools = {
      list: () => tab.request('tools.list', {}),
      add: async (tool) => {
        await tab.request('tools.add', { tool });
      },
      importFile: (fileName, bytes) => tab.request('tools.import', { fileName, bytes: toBase64(bytes) }),
    };
  }

  describe(): Promise<SessionInfo> {
    return this.tab.request('describe', {});
  }

  job(): Promise<Job> {
    return this.tab.request('job', {});
  }

  apply(commands: readonly JobCommand[], label?: string): Promise<Job> {
    return this.tab.request('apply', { commands: [...commands], label: label ?? `${commands.length} change(s)` });
  }

  importModel(input: ModelInput): Promise<ImportOutcome> {
    return this.tab.request('importModel', {
      fileName: input.fileName, bytes: toBase64(input.bytes),
      ...(input.units ? { units: input.units } : {}), ...(input.body !== undefined ? { body: input.body } : {}),
    });
  }

  run(): Promise<RunReport> {
    return this.tab.request('run', {});
  }

  catalog(): Promise<GeometryCatalog | null> {
    return this.tab.request('catalog', {});
  }

  boxes(): Promise<Boxes> {
    return this.tab.request('boxes', {});
  }

  previewSvg(options: PreviewOptions): Promise<string> {
    return this.tab.request('previewSvg', { ...options, ...(options.operations ? { operations: [...options.operations] } : {}) });
  }

  /** Without a path: the tab writes through its own file handle and its file name comes back. With a path: the server writes the tab's bytes. */
  async save(path?: string): Promise<string> {
    if (path === undefined) return (await this.tab.request('save', {})).name;
    const { bytes, token } = await this.tab.request('saveBytes', {});
    const file = withSponExtension(path);
    try {
      await writeFileAtomic(file, fromBase64(bytes));
    } catch (err) {
      throw new SessionError(`Could not write ${file}: ${message(err)}`);
    }
    await this.tab.request('markSaved', { token });
    return file;
  }

  exportGcode(): Promise<ExportOutcome> {
    return this.tab.request('exportGcode', {});
  }

  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef> {
    return this.tab.request('importProgram', { fileName, bytes: toBase64(bytes) });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp test live-session && pnpm --filter @sponcam/mcp typecheck`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/live/liveSession.ts packages/mcp/test/fakeTab.ts packages/mcp/test/live-session.test.ts
git commit -m "feat(mcp): LiveSession drives the tab's job over the bridge"
```

---

### Task 5: MCP — `use_live_tab`, status, disconnects, the entry point and docs

**Files:**
- Create: `packages/mcp/src/live/options.ts`
- Modify: `packages/mcp/src/context.ts` (`ServerDeps.bridge`, clear the session when its tab goes)
- Modify: `packages/mcp/src/tools/session.ts` (`status`, `use_live_tab`, `save_job` text)
- Modify: `packages/mcp/src/instructions.ts` (live mode paragraph)
- Modify: `packages/mcp/src/main.ts`
- Modify: `packages/mcp/test/stdio.test.ts` (pass `--port 0`; new exit test)
- Modify: `packages/mcp/README.md`, `THIRD_PARTY_NOTICES.md`
- Test: `packages/mcp/test/live-options.test.ts`, `packages/mcp/test/tools-live.test.ts`

**Interfaces:**
- Consumes: `LiveBridge`, `TabConnection`, `LiveSession`, `DEFAULT_ORIGINS`, `NO_JOB`, `ServerState.clear`, `statusText`.
- Produces:
  - `bridgePort(argv: readonly string[], env: NodeJS.ProcessEnv): number`; `allowedOrigins(env: NodeJS.ProcessEnv): string[]`
  - `ServerDeps.bridge?: LiveBridge | null`
  - the tool `use_live_tab { discard? }`
  - `status` structured content `{ session, liveTab: { title, dirty } | null, bridge: string }`

- [ ] **Step 1: Write the failing tests**

`packages/mcp/test/live-options.test.ts`:

```ts
import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIGINS } from '../src/live/bridge';
import { allowedOrigins, bridgePort } from '../src/live/options';

describe('bridge options', () => {
  it('takes the port from --port, then SPON_BRIDGE_PORT, then the default', () => {
    expect(bridgePort([], {})).toBe(DEFAULT_BRIDGE_PORT);
    expect(bridgePort([], { SPON_BRIDGE_PORT: '6001' })).toBe(6001);
    expect(bridgePort(['--port', '6002'], { SPON_BRIDGE_PORT: '6001' })).toBe(6002);
    expect(bridgePort(['--port=0'], {})).toBe(0);
    expect(bridgePort(['--port', 'abc'], {})).toBe(DEFAULT_BRIDGE_PORT);
    expect(bridgePort([], { SPON_BRIDGE_PORT: '70000' })).toBe(DEFAULT_BRIDGE_PORT);
  });

  it('adds SPON_ALLOWED_ORIGINS to the default origins', () => {
    expect(allowedOrigins({})).toEqual(DEFAULT_ORIGINS);
    expect(allowedOrigins({ SPON_ALLOWED_ORIGINS: ' http://a.local:1 ,http://b.local:2,' })).toEqual([...DEFAULT_ORIGINS, 'http://a.local:1', 'http://b.local:2']);
  });
});
```

`packages/mcp/test/tools-live.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSession } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { LiveBridge } from '../src/live/bridge';
import { loadNodeOcct } from '../src/occt';
import { connect, data, text } from './connect';
import { openTab, sessionHandler } from './fakeTab';
import { tempDir } from './helpers';

const bridges: LiveBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});

async function withBridge(port = 0) {
  const bridge = new LiveBridge({ port, serverVersion: 'test' });
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}
function backingTab(bridge: LiveBridge, title = 'Tab job') {
  if (bridge.state.status !== 'listening') throw new Error('bridge is not listening');
  const backing = FileSession.create({ name: title }, { library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });
  return openTab(bridge.state.port, { title, handle: sessionHandler(backing).handle });
}
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
  expect(await check()).toBe(true);
};

describe('live tools', () => {
  it('reports the bridge and asks for a tab', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge });
    const status = await call('status');
    expect(data(status)).toMatchObject({ session: null, liveTab: null, bridge: bridge.describe() });
    const none = await call('use_live_tab');
    expect(none.isError).toBe(true);
    expect(text(none)).toBe('No Spon tab is connected. In the Spon web app, click "Claude" in the status bar to connect.');
  });

  it('drives a connected tab through the usual tools', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge }, ['cam-part.dxf']);
    const tab = backingTab(bridge);
    await tab.welcomed;
    const used = await call('use_live_tab');
    expect(text(used)).toContain('Live tab: job "Tab job"');
    expect(data(await call('status')).liveTab).toEqual({ title: 'Tab job', dirty: false });
    expect(data(await call('import_model', { path: 'cam-part.dxf' })).status).toBe('imported');
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 6 } } }], label: 'Stock' });
    const catalog = data(await call('describe_geometry')) as { contours: { handle: string; layer: string }[] };
    const outline = catalog.contours.filter((c) => c.layer === 'OUTLINE').map((c) => c.handle);
    const added = await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: outline });
    expect(added.isError).toBeFalsy();
    const generated = data(await call('generate')) as { operations: { status: string }[] };
    expect(generated.operations.map((o) => o.status)).not.toContain('error');
    expect((await call('render_preview')).content[0].type).toBe('image');
    expect(tab.methods).toEqual(expect.arrayContaining(['apply', 'run', 'catalog', 'previewSvg', 'tools.list']));
  });

  it('never refuses to leave a live tab, and leaves a dirty file job only with discard', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge }, ['cam-part.dxf']);
    const tab = backingTab(bridge);
    await tab.welcomed;
    await call('new_job');
    await call('import_model', { path: 'cam-part.dxf' });
    expect(text(await call('use_live_tab'))).toBe('The current job has unsaved changes — save_job first, or pass discard: true');
    expect((await call('use_live_tab', { discard: true })).isError).toBeFalsy();
    expect((await call('new_job')).isError).toBeFalsy();
  });

  it('drops the session when the tab goes, and headless keeps working (review focus 5)', async () => {
    const bridge = await withBridge();
    const { call } = await connect({ bridge });
    const tab = backingTab(bridge);
    await tab.welcomed;
    await call('use_live_tab');
    tab.socket.close();
    await until(async () => text(await call('status')).startsWith('No job open. Use new_job, open_job or use_live_tab.'));
    expect(text(await call('get_job'))).toBe('No job open. Use new_job, open_job or use_live_tab.');
    expect((await call('new_job')).isError).toBeFalsy();
  });

  it('explains a bridge that could not start (review focus 3)', async () => {
    const first = await withBridge();
    if (first.state.status !== 'listening') throw new Error('first bridge did not start');
    const second = await withBridge(first.state.port);
    const { call } = await connect({ bridge: second });
    const r = await call('use_live_tab');
    expect(text(r)).toBe(`The live bridge is unavailable: port ${first.state.port} in use`);
    expect(text(await call('status'))).toContain(`live bridge unavailable: port ${first.state.port} in use`);
    expect((await call('new_job')).isError).toBeFalsy();
  });
});
```

In `packages/mcp/test/stdio.test.ts`:
- Both `StdioClientTransport` blocks use `args: [DIST, '--port', '0']`. A test run must never bind 5197.
- Remove the `session_info` call, which names a tool that does not exist. Replace it with `await client.callTool({ name: 'status', arguments: {} });`.
- Add this test (it needs `import { spawn } from 'node:child_process';`):

```ts
  it('exits when stdin closes, although the bridge is listening (review focus 2)', async () => {
    const child = spawn(process.execPath, [DIST, '--port', '0'], { cwd: tempDir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    for (let i = 0; i < 100 && !stderr.includes('live bridge listening'); i++) await new Promise((r) => setTimeout(r, 50));
    expect(stderr).toContain('live bridge listening');
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.stdin.end();
    const code = await Promise.race([exited, new Promise<'hung'>((r) => setTimeout(() => r('hung'), 10_000))]);
    if (code === 'hung') child.kill();
    expect(code).toBe(0);
  }, 30_000);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test live-options tools-live`
Expected: FAIL. `../src/live/options` does not exist, and there is no `use_live_tab` tool.

- [ ] **Step 3: Write the implementation**

`packages/mcp/src/live/options.ts`:

```ts
import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { log } from '../log';
import { DEFAULT_ORIGINS } from './bridge';

const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 65535;

/** `--port <n>` or `--port=<n>`, then SPON_BRIDGE_PORT, then 5197. Port 0 picks any free port (tests). */
export function bridgePort(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  let raw: string | undefined;
  argv.forEach((arg, i) => {
    if (arg === '--port') raw = argv[i + 1];
    else if (arg.startsWith('--port=')) raw = arg.slice('--port='.length);
  });
  raw ??= env.SPON_BRIDGE_PORT;
  if (raw === undefined || raw === '') return DEFAULT_BRIDGE_PORT;
  const port = Number(raw);
  if (valid(port)) return port;
  log(`ignoring bridge port "${raw}"; using ${DEFAULT_BRIDGE_PORT}`);
  return DEFAULT_BRIDGE_PORT;
}

export function allowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const extra = (env.SPON_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}
```

`packages/mcp/src/context.ts`:
- Add to `ServerDeps`: `/** The live bridge; null or absent: file sessions only. */ bridge?: LiveBridge | null;`.
- Import `LiveBridge` (type), `LiveSession`.
- In `createContext`, after `const state = new ServerState();`:

```ts
  // a live session whose tab disconnected or was replaced is no longer a session
  deps.bridge?.onTabGone((tab) => {
    if (state.session instanceof LiveSession && state.session.tab === tab) state.clear();
  });
```

`packages/mcp/src/tools/session.ts`:
- Import `LiveSession` from `../live/liveSession`.
- `status` becomes:

```ts
  }, guarded('status', async () => {
    const info = state.session ? await state.session.describe() : null;
    const bridge = ctx.deps.bridge;
    const tab = bridge?.tab ?? null;
    const liveTab = tab ? { title: tab.title, dirty: tab.dirty } : null;
    const bridgeText = bridge ? bridge.describe() : 'live bridge off';
    const lines = [
      info ? statusText(info) : NO_JOB,
      tab ? `A Spon tab is connected: "${tab.title}"${info?.kind === 'live' ? '' : ' (use_live_tab to drive it)'}.` : `No Spon tab connected (${bridgeText}).`,
    ];
    return ok(lines.join('\n'), { session: info, liveTab, bridge: bridgeText });
  }));
```

- Register `use_live_tab` after `open_job`:

```ts
const useLiveShape = { discard: z.boolean().optional().describe('Drop unsaved changes to the current file job') };
```

```ts
  server.registerTool('use_live_tab', {
    title: 'Use live tab',
    description: 'Drive the job open in the Spon web app tab. Every change shows there and is one undo step. Refused while a file job has unsaved changes, unless discard is true.',
    inputSchema: useLiveShape,
  }, guarded('use_live_tab', async (a: Args<typeof useLiveShape>) => {
    const bridge = ctx.deps.bridge;
    if (!bridge || bridge.state.status !== 'listening') {
      throw new SessionError(`The live bridge is unavailable${bridge?.state.status === 'unavailable' ? `: ${bridge.state.reason}` : ''}`);
    }
    const tab = bridge.tab;
    if (!tab) throw new SessionError('No Spon tab is connected. In the Spon web app, click "Claude" in the status bar to connect.');
    await state.ensureCanSwitch(a.discard);
    state.use(new LiveSession(tab));
    const info = await state.requireSession().describe();
    return ok(`${statusText(info)}\nEvery change appears in the tab and is one undo step there.`, { session: info });
  }));
```

- `save_job` text: `Saved ${path}` stays as it is. A live save without a path returns the file name, which reads correctly.

`packages/mcp/src/instructions.ts`: add before the final "Always tell the user…" line:

```
Live mode
- If the user has the Spon web app open and clicked "Claude" in its status bar, use_live_tab drives that tab instead of a file. Every change appears in the tab and is one undo step there. save_job without a path saves through the tab's own file; with a path the server writes it.
- status says whether a tab is connected. If the tab closes, the job is no longer open: use new_job / open_job, or ask the user to reconnect.
```

`packages/mcp/src/main.ts`:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultLibraryPath, ToolLibraryFile } from './library';
import { LiveBridge } from './live/bridge';
import { allowedOrigins, bridgePort } from './live/options';
import { log } from './log';
import { loadNodeOcct } from './occt';
import { svgToPng } from './raster';
import { createSponServer } from './server';
import { VERSION } from './version';

const libraryPath = defaultLibraryPath();
const bridge = new LiveBridge({ port: bridgePort(process.argv.slice(2), process.env), allowedOrigins: allowedOrigins(process.env), serverVersion: VERSION });
await bridge.start();
const server = createSponServer({ cwd: process.cwd(), library: new ToolLibraryFile(libraryPath), loadReader: loadNodeOcct, rasterize: svgToPng, bridge });
await server.connect(new StdioServerTransport());
log(`spon-mcp ${VERSION} ready in ${process.cwd()} (tool library ${libraryPath}; ${bridge.describe()})`);

// the listening WebSocket server would keep the process alive after Claude Code closes the pipe
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void bridge.close().finally(() => process.exit(0));
};
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
```

`packages/mcp/README.md`:
- Add `use_live_tab` to the tool list.
- Add rows to the environment table: `SPON_BRIDGE_PORT` (default `5197`; the live bridge port, also `--port <n>`) and `SPON_ALLOWED_ORIGINS` (extra comma-separated origins allowed to connect).
- Add a section:

```markdown
## Live mode

The server also listens on `ws://127.0.0.1:5197` (loopback only). In the Spon web app, click **Claude** in the status
bar: the tab connects, and `use_live_tab` lets Claude drive the job open there. Every tool call is one undo step in the
tab, and each change shows a short "Claude: …" toast. Only pages served from localhost on the dev, preview and test
ports (5173, 4173, 5198, 5199) may connect, plus any origin in `SPON_ALLOWED_ORIGINS`. One tab at a time: clicking
Claude in another tab takes over. If the port is taken (a second Claude session), the server runs file-only and
`status` says so.
```

`THIRD_PARTY_NOTICES.md`, in the MCP server list: `- **ws** (MIT), the WebSocket server for the live bridge.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp typecheck && pnpm --filter @sponcam/mcp test`
Expected: PASS. This includes the stdio tests, which rebuild the bundle.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp THIRD_PARTY_NOTICES.md
git commit -m "feat(mcp): use_live_tab, bridge status, session cleared on disconnect, --port and clean exit"
```

---

### Task 6: Web — batch dispatch, pipeline freshness and worker catalog/preview

**Files:**
- Modify: `packages/web/src/state/store.ts` (`dispatchBatch`)
- Modify: `packages/web/src/state/cam.ts`
- Modify: `packages/web/src/workers/import.worker.ts` (`catalog`, `previewSvg`)
- Modify: `packages/web/src/workers/importClient.ts` (`catalogInWorker`, `previewSvgInWorker`)
- Test: `packages/web/src/state/store.test.ts`, `packages/web/src/state/cam.test.ts`

**Interfaces:**
- Consumes: `applyCommands`, `programContext`, `previewInput`, `renderPreviewSvg`, `PreviewOptions`, `GeometryCatalog` (core).
- Produces:
  - `AppState.dispatchBatch(commands: readonly JobCommand[]): void` (one undo step; throws `CommandError` and leaves the state unchanged)
  - in `cam.ts`: `camInputsChanged(a: Job, b: Job, ga: ModelGeometry | null, gb: ModelGeometry | null): boolean`; `ensureCamModel(geometry: ModelGeometry | null): Promise<void>`; `currentCamRun(s: Pick<AppState, 'job' | 'geometry' | 'camStatus'>): CamRun | null`; `waitForCamRun(store?: StoreApi<AppState>): Promise<{ job: Job; run: CamRun }>`; `camCatalog(): Promise<GeometryCatalog | null>`; `camPreviewSvg(options: PreviewOptions): Promise<string>`; `EMPTY_RUN: CamRun`
  - `catalogInWorker(job: Job): Promise<GeometryCatalog | null>`; `previewSvgInWorker(job: Job, ctx: ProgramContext, options: PreviewOptions): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/src/state/store.test.ts` (import `CommandError` and `type JobCommand` from `@sponcam/core`):

```ts
  it('applies a batch as one undo step, all or nothing', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    const add = (id: string): JobCommand => ({ type: 'addOperation', opType: 'drill', toolId: null, id });
    s().dispatchBatch([add('a'), add('b')]);
    expect(s().job.operations.map((o) => o.id)).toEqual(['a', 'b']);
    expect(s().past).toHaveLength(1);
    const before = s().job;
    expect(() => s().dispatchBatch([add('c'), { type: 'updateOperation', id: 'nope', patch: { name: 'x' } }]))
      .toThrow(new CommandError('commands[1] updateOperation: No operation with id nope'));
    expect(s().job).toBe(before);
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(s().job.operations).toEqual([]);
  });
```

In `packages/web/src/state/cam.test.ts`:
- Add to the hoisted `worker` mock: `catalogInWorker: vi.fn(async () => null), previewSvgInWorker: vi.fn(async () => '<svg/>'),`.
- Destructure `camCatalog, camInputsChanged, camPreviewSvg, currentCamRun, waitForCamRun` from `await import('./cam')` as well.
- Add these tests:

```ts
  it('treats only toolpath inputs as changes', () => {
    const job = withOp();
    expect(camInputsChanged(job, { ...job, programs: [] }, null, null)).toBe(false);
    expect(camInputsChanged(job, { ...job, name: 'Other' }, null, null)).toBe(true);
    expect(camInputsChanged(job, job, null, { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() })).toBe(true);
  });

  it('waits for the run of the current job, also across an edit during generation (review focus 1)', async () => {
    appStore.setState({ job: withOp(), camStatus: 'generating' });
    let release!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const waiting = waitForCamRun();
    const first = regenerate();
    // regenerate sends the model first; wait until the generate call (and its release function) exists
    await vi.waitFor(() => expect(worker.generateInWorker).toHaveBeenCalledTimes(1));
    // the user renames the job while the first run is in flight: its output must not be returned
    appStore.getState().commit((j) => ({ ...j, name: 'Renamed' }));
    worker.generateInWorker.mockResolvedValueOnce(run(['renamed.nc']));
    release(run(['old.nc']));
    await first;
    const { job, run: got } = await waiting;
    expect(job.name).toBe('Renamed');
    expect(got.files.map((f) => f.name)).toEqual(['renamed.nc']);
    expect(currentCamRun(appStore.getState())).toBe(got);
  });

  it('rejects when generation failed for the current job', async () => {
    appStore.setState({ job: withOp(), camStatus: 'generating' });
    worker.generateInWorker.mockRejectedValueOnce(new Error('boom'));
    const waiting = waitForCamRun();
    await regenerate();
    await expect(waiting).rejects.toThrow('Toolpath generation failed; see the tab');
  });

  it('answers at once for a job without operations', async () => {
    appStore.setState({ job: createJob('Empty'), camStatus: 'generating' });
    const waiting = waitForCamRun();
    await regenerate();
    expect((await waiting).run).toEqual({ results: [], files: [], catalog: null });
  });

  it('sends the model before asking the worker for the catalog and the preview', async () => {
    appStore.setState({ job: withOp(), geometry: null });
    await camCatalog();
    expect(worker.catalogInWorker).toHaveBeenCalledWith(appStore.getState().job);
    expect(await camPreviewSvg({ view: 'iso' })).toBe('<svg/>');
    expect(worker.previewSvgInWorker).toHaveBeenCalledWith(appStore.getState().job, expect.anything(), { view: 'iso' });
  });
```

The test for review focus 1 relies on `regenerate` re-running itself when the job changed during the await (the existing `check() === 'changed'` branch). The second, recursive run uses the `mockResolvedValueOnce` value.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test store cam.test`
Expected: FAIL. `dispatchBatch`, `camInputsChanged` and the other new functions are missing.

- [ ] **Step 3: Write the implementation**

`packages/web/src/state/store.ts`:
- Import `applyCommands` from core.
- In `AppState`, after `dispatch`, add:

```ts
  /** Applies several job commands as one undo step, all or none; a CommandError names the failing command. */
  dispatchBatch(commands: readonly JobCommand[]): void;
```

- In the store, after `dispatch`:

```ts
    dispatchBatch(commands) {
      get().commit((job) => applyCommands(job, commands));
    },
```

`commit` calls the update before any `set`, so a throwing batch changes nothing.

`packages/web/src/workers/import.worker.ts`:
- Add `type GeometryCatalog`, `type PreviewOptions`, `previewInput` and `renderPreviewSvg` to the core import.
- Add to `api`:

```ts
  /** The geometry catalog for `job` and the model set with setCamModel (the live bridge's describe_geometry). */
  catalog(job: Job): GeometryCatalog | null {
    return pipeline.catalogFor(job, camGeometry);
  },
  /** The preview drawing of `job` (the live bridge's render_preview); cached operations make this cheap after a generate. */
  previewSvg(job: Job, ctx: ProgramContext, options: PreviewOptions): string {
    return renderPreviewSvg(previewInput(job, camGeometry, runPipeline(job, camGeometry, ctx, pipeline)), options);
  },
```

`packages/web/src/workers/importClient.ts` (add `type GeometryCatalog` and `type PreviewOptions` to the core import):

```ts
export function catalogInWorker(job: Job): Promise<GeometryCatalog | null> {
  return run((api) => api.catalog(job), 'Describing the geometry timed out');
}

export function previewSvgInWorker(job: Job, ctx: ProgramContext, options: PreviewOptions): Promise<string> {
  return run((api) => api.previewSvg(job, ctx, options), 'Rendering the preview timed out');
}
```

`packages/web/src/state/cam.ts`:
- Add `type GeometryCatalog`, `type Job` and `type PreviewOptions` to the core import.
- Import `catalogInWorker` and `previewSvgInWorker`.
- Then:

```ts
export const EMPTY_RUN: CamRun = { results: [], files: [], catalog: null };

/** True when the change from (a, ga) to (b, gb) can change the toolpaths: what triggers regeneration. */
export function camInputsChanged(a: Job, b: Job, ga: ModelGeometry | null, gb: ModelGeometry | null): boolean {
  return (
    a.operations !== b.operations || a.tools !== b.tools || a.post !== b.post || a.tolerance !== b.tolerance || a.model !== b.model ||
    a.stock !== b.stock || a.wcs !== b.wcs || a.machine !== b.machine || a.displayUnits !== b.displayUnits || a.name !== b.name || ga !== gb
  );
}

/** The newest finished run and the inputs it was made from. */
let latest: { job: Job; geometry: ModelGeometry | null; run: CamRun } | null = null;

/** Sends the model to the worker when it changed or the worker was replaced. */
export async function ensureCamModel(geometry: ModelGeometry | null): Promise<void> {
  if (geometry === sentGeometry && workerEpoch() === sentEpoch) return;
  const epoch = workerEpoch();
  await setCamModelInWorker(geometry);
  sentGeometry = geometry;
  sentEpoch = epoch;
}
```

Move the `let sentGeometry` / `let sentEpoch` declarations above `ensureCamModel`. In `regenerate`:
- replace the inline model-sending block with `await ensureCamModel(geometry);`;
- in the no-operations branch, set `latest = { job, geometry, run: EMPTY_RUN };` before the existing state updates;
- on success, set `latest = { job, geometry, run: result };` before `setCamOutput`.

In `startCamPipeline`, the subscription becomes `if (camInputsChanged(prev.job, s.job, prev.geometry, s.geometry)) schedule();`. Then add:

```ts
/** The newest run, if the pipeline is idle and nothing that affects toolpaths changed since it was made. */
export function currentCamRun(s: Pick<AppState, 'job' | 'geometry' | 'camStatus'>): CamRun | null {
  if (s.camStatus !== 'idle' || !latest) return null;
  return camInputsChanged(latest.job, s.job, latest.geometry, s.geometry) ? null : latest.run;
}

/** Resolves with the run for the job as it is now, once the pipeline is idle; rejects when generation failed. */
export function waitForCamRun(store: StoreApi<AppState> = appStore): Promise<{ job: Job; run: CamRun }> {
  return new Promise((resolve, reject) => {
    // read the store, not the listener's argument: a nested set (the pipeline marking itself 'generating') may have happened since
    const settle = (): boolean => {
      const s = store.getState();
      if (s.camStatus !== 'idle') return false;
      const run = currentCamRun(s);
      if (run) resolve({ job: s.job, run });
      else reject(new Error('Toolpath generation failed; see the tab'));
      return true;
    };
    if (settle()) return;
    const unsubscribe = store.subscribe(() => {
      if (settle()) unsubscribe();
    });
  });
}

export async function camCatalog(): Promise<GeometryCatalog | null> {
  const { job, geometry } = appStore.getState();
  await ensureCamModel(geometry);
  return catalogInWorker(job);
}

export async function camPreviewSvg(options: PreviewOptions): Promise<string> {
  const { job, geometry } = appStore.getState();
  await ensureCamModel(geometry);
  return previewSvgInWorker(job, programContext(job, geometry), options);
}
```

The existing `cam.test.ts` `beforeEach` resets the store but not `latest`. That is fine: the tests that call `waitForCamRun` first run `regenerate` for their own job.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test store cam.test && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/store.ts packages/web/src/state/store.test.ts packages/web/src/state/cam.ts packages/web/src/state/cam.test.ts packages/web/src/workers
git commit -m "feat(web): batch dispatch as one undo step, wait for a current CAM run, worker catalog and preview"
```

---

### Task 7: Web — import, save, program and library functions the bridge calls

**Files:**
- Modify: `packages/web/src/state/documents.ts`
- Modify: `packages/web/src/state/programs.ts` (`importProgramBytes` returns the ref)
- Modify: `packages/web/src/state/toolLibrary.ts`
- Test: `packages/web/src/state/documents-bridge.test.ts` (new), `packages/web/src/state/toolLibrary.test.ts`

**Interfaces:**
- Consumes: `decideImport`, `importedOutcome`, `newModelRef`, `operationsWithGeometry`, `ImportOutcome`, `ImportStep` (core).
- Produces:
  - `importModelOutcome(fileName: string, bytes: Uint8Array, units?: LengthUnit, body?: number): Promise<ImportOutcome>`
  - `saveToCurrentHandle(): Promise<string>`; `sponBytesForSave(): { bytes: Uint8Array; token: number }`; `markSavedIfCurrent(token: number): boolean`
  - `importProgramBytes(name, bytes): Promise<ProgramRef | null>`
  - `listLibraryTools(): Promise<Tool[]>`; `importLibraryBytes(fileName: string, bytes: Uint8Array): Promise<LibraryImportResult>`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/state/documents-bridge.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { createJob, importFile } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  importInWorker: vi.fn(),
  cadReaderLoaded: () => true,
  loadCadReaderInWorker: vi.fn(async () => {}),
}));
vi.mock('../workers/importClient', () => worker);
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { importModelOutcome, markSavedIfCurrent, saveToCurrentHandle, sponBytesForSave } = await import('./documents');
const { appStore } = await import('./store');

const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

beforeEach(() => {
  worker.importInWorker.mockReset();
  worker.importInWorker.mockImplementation(async (name: string, bytes: Uint8Array) => importFile(name, bytes));
  appStore.setState({ job: createJob('Tab'), geometry: null, modelBytes: null, past: [], future: [], dirty: false, fileHandle: null, pendingImport: null, pendingBodies: null });
});

describe('bridge import', () => {
  it('answers needsUnits instead of opening the units dialog', async () => {
    const outcome = await importModelOutcome('part.stl', STL);
    expect(outcome.status).toBe('needsUnits');
    expect(appStore.getState().pendingImport).toBeNull();
    expect(appStore.getState().job.model).toBeNull();
  });

  it('imports with the given units, starting a new undo history, and says so', async () => {
    appStore.getState().commit((j) => ({ ...j, name: 'Edited' }));
    const outcome = await importModelOutcome('part.stl', STL, 'mm');
    if (outcome.status !== 'imported') throw new Error(`expected imported, got ${outcome.status}`);
    expect(outcome.size).toEqual({ x: 2, y: 1, z: 0 });
    expect(outcome.warnings).toContain('Importing a model starts a new undo history in the tab');
    expect(appStore.getState().job.model?.sourceName).toBe('part.stl');
    expect(appStore.getState().past).toEqual([]);
  });

  it('turns reader failures into an error outcome', async () => {
    worker.importInWorker.mockRejectedValueOnce(new Error('Import timed out'));
    expect(await importModelOutcome('part.stl', STL, 'mm')).toEqual({ status: 'error', error: 'Import timed out' });
  });
});

describe('bridge save', () => {
  it('needs a file handle to save in place', async () => {
    await expect(saveToCurrentHandle()).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('marks the tab saved only if the job did not change after the bytes were taken', () => {
    appStore.setState({ dirty: true });
    const first = sponBytesForSave();
    expect(first.bytes.length).toBeGreaterThan(0);
    appStore.getState().commit((j) => ({ ...j, name: 'Changed meanwhile' }));
    expect(markSavedIfCurrent(first.token)).toBe(false);
    expect(appStore.getState().dirty).toBe(true);
    const second = sponBytesForSave();
    expect(markSavedIfCurrent(first.token)).toBe(false);
    expect(markSavedIfCurrent(second.token)).toBe(true);
    expect(appStore.getState().dirty).toBe(false);
    expect(appStore.getState().fileHandle).toBeNull();
  });
});
```

Add to `packages/web/src/state/toolLibrary.test.ts` (import `listLibraryTools` and `importLibraryBytes`):

```ts
  it('lists and imports for the live bridge', async () => {
    await loadToolLibrary();
    const listed = await listLibraryTools();
    expect(listed.map((t) => t.id)).toEqual(tools().map((t) => t.id));
    const mine = { ...starterLibrary()[1], id: 'bridge-tool', name: 'Bridge 6 mm', number: 77 };
    const result = await importLibraryBytes('lib.json', new TextEncoder().encode(exportToolLibrary([mine])));
    expect(result.added).toBe(1);
    expect((await listLibraryTools()).some((t) => t.id === 'bridge-tool')).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test documents-bridge toolLibrary`
Expected: FAIL. The new functions are not exported.

- [ ] **Step 3: Write the implementation**

`packages/web/src/state/documents.ts`:
- Add `decideImport`, `type ImportOutcome`, `type ImportStep`, `importedOutcome`, `newModelRef` and `operationsWithGeometry` to the core import.
- Split the reading out of `importModelBytes`:

```ts
/** Reads a model file in the worker, loading the STEP/IGES reader first; shows busy text. Throws with a message. */
async function readModelFile(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportStep> {
  const cad = cadFormat(fileName);
  try {
    if (cad && !cadReaderLoaded()) {
      state().setBusy(`Loading ${CAD_LABEL[cad]} reader…`);
      try {
        await loadCadReaderInWorker();
      } catch (err) {
        throw new Error(`Could not load the ${CAD_LABEL[cad]} reader: ${message(err)}`);
      }
    }
    state().setBusy(cad ? `Reading ${CAD_LABEL[cad]} file…` : `Importing ${fileName}…`);
    return importStep(await importInWorker(fileName, bytes, body));
  } finally {
    state().setBusy(null);
  }
}

export async function importModelBytes(fileName: string, bytes: Uint8Array, body?: number): Promise<void> {
  let step: ImportStep;
  try {
    step = await readModelFile(fileName, bytes, body);
  } catch (err) {
    toast.error(`Could not import ${fileName}: ${message(err)}`);
    return;
  }
  if (step.kind === 'error') {
  // … the rest of the function as it is today, from the `step.kind === 'error'` check on
```

- `finishImport` builds the model with `newModelRef(pending.fileName, pending.geometry, units, blobId)` instead of the inline object. Remove the `source` local.
- Add:

```ts
/** The live bridge's import: never opens a dialog, answers needsUnits / needsBody instead. */
export async function importModelOutcome(fileName: string, bytes: Uint8Array, units?: LengthUnit, body?: number): Promise<ImportOutcome> {
  let step: ImportStep;
  try {
    step = await readModelFile(fileName, bytes, body);
  } catch (err) {
    return { status: 'error', error: message(err) };
  }
  const decision = decideImport(step, units);
  if (decision.status !== 'ready') return decision;
  const affected = operationsWithGeometry(state().job);
  await finishImport({ fileName, bytes, geometry: decision.geometry, warnings: decision.warnings, suggestedUnits: decision.units }, decision.units);
  const outcome = importedOutcome(state().job, decision.geometry, decision.units, decision.warnings, affected);
  return outcome.status === 'imported' ? { ...outcome, warnings: [...outcome.warnings, 'Importing a model starts a new undo history in the tab'] } : outcome;
}

function currentSponBytes(): Uint8Array {
  const { job, modelBytes, programBytes } = state();
  const blobs: BlobMap = { ...programBytes };
  if (job.model && modelBytes) blobs[job.model.blobId] = modelBytes;
  return writeSpon(job, blobs);
}

/** The live bridge's save without a path: writes through the tab's file handle. Returns the file name. */
export async function saveToCurrentHandle(): Promise<string> {
  const { fileHandle } = state();
  if (!fileHandle) throw new Error('This tab has no file yet — give a path');
  await writeToHandle(fileHandle, currentSponBytes());
  state().markSaved(fileHandle);
  return fileHandle.name;
}

let saveToken = 0;
let pendingSave: { token: number; job: Job } | null = null;

/** The job as .spon bytes for the MCP server to write; markSavedIfCurrent(token) follows once it is on disk. */
export function sponBytesForSave(): { bytes: Uint8Array; token: number } {
  pendingSave = { token: ++saveToken, job: state().job };
  return { bytes: currentSponBytes(), token: pendingSave.token };
}

/** Clears the dirty flag (and the file handle: the file now lives where the server wrote it) if the job is what was saved. */
export function markSavedIfCurrent(token: number): boolean {
  if (!pendingSave || pendingSave.token !== token || state().job !== pendingSave.job) return false;
  pendingSave = null;
  state().markSaved(null);
  return true;
}
```

- `saveDocument` uses `const bytes = currentSponBytes();` instead of building the blobs itself.

`packages/web/src/state/programs.ts`, `importProgramBytes`: change the return type to `Promise<ProgramRef | null>` (add `type ProgramRef` to the core import) and `return added ?? null;` at the end. Existing callers ignore the value.

`packages/web/src/state/toolLibrary.ts`:

```ts
export async function listLibraryTools(): Promise<Tool[]> {
  return sortTools(await (await db()).getAll('tools'));
}

export async function importLibraryBytes(
  fileName: string,
  bytes: Uint8Array,
): Promise<{ added: number; updated: number; skipped: { name: string; reason: string }[]; notes: string[] }> {
  const result = parseToolLibraryFile(bytes, fileName);
  const d = await db();
  const merge = mergeToolLibrary(await d.getAll('tools'), result.tools);
  const tx = d.transaction('tools', 'readwrite');
  for (const t of merge.incoming) await tx.store.put(t, t.id);
  await tx.done;
  await refresh();
  return { added: merge.added, updated: merge.updated, skipped: result.skipped, notes: merge.notes };
}

export async function importLibraryFile(file: File): ReturnType<typeof importLibraryBytes> {
  return importLibraryBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}
```

The old body of `importLibraryFile` is replaced by the delegation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web typecheck`
Expected: PASS. The whole web unit suite passes, including the existing documents-adjacent tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state
git commit -m "feat(web): dialog-free import outcome, save-for-bridge and library functions for the live bridge"
```

---

### Task 8: Web — bridge request handlers

**Files:**
- Create: `packages/web/src/bridge/handlers.ts`
- Test: `packages/web/src/bridge/handlers.test.ts`

**Interfaces:**
- Consumes: Task 6 (`dispatchBatch`, `waitForCamRun`, `camCatalog`, `camPreviewSvg`); Task 7 functions; `saveLibraryTool`; `runReport`, `exportOutcome`, `modelSummary`, `camContext`, `fromBase64`, `toBase64`, `BridgeMethod`, `BridgeParams`, `BridgeResult` (core).
- Produces: `type Handlers = { [M in BridgeMethod]: (params: BridgeParams<M>) => Promise<BridgeResult<M>> }`; `export const handlers: Handlers`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/bridge/handlers.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { applyCommand, createJob, type JobCommand, starterLibrary } from '@sponcam/core';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamRun } from '../state/camTypes';

const worker = vi.hoisted(() => ({
  setCamModelInWorker: vi.fn(async () => {}),
  generateInWorker: vi.fn(),
  catalogInWorker: vi.fn(async () => null),
  previewSvgInWorker: vi.fn(async () => '<svg/>'),
  importInWorker: vi.fn(),
  cadReaderLoaded: () => true,
  loadCadReaderInWorker: vi.fn(async () => {}),
  parseProgramInWorker: vi.fn(async () => { throw new Error('not parsed in this test'); }),
  analyzeInWorker: vi.fn(),
  workerEpoch: () => 0,
}));
vi.mock('../workers/importClient', () => worker);
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { handlers } = await import('./handlers');
const { regenerate } = await import('../state/cam');
const { appStore } = await import('../state/store');

const parsed = { table: { count: 0 }, analysis: { summary: { totalSeconds: 3, lineCount: 2, extents: null }, diagnostics: [] }, interpretDiagnostics: [] } as never;
const run = (): CamRun => ({
  results: [{ operationId: 'o1', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true }],
  files: [{ name: 'job.nc', text: 'G0 X0\n', operationIds: ['o1'], tools: [1], sections: [], parsed, postErrors: [] }],
  catalog: null,
});
const add = (id: string): JobCommand => ({ type: 'addOperation', opType: 'drill', toolId: null, id });

beforeEach(() => {
  vi.mocked(toast).mockClear();
  worker.generateInWorker.mockReset();
  appStore.setState({ job: createJob('Tab'), geometry: null, past: [], future: [], dirty: false, fileHandle: null, camStatus: 'idle' });
});

describe('bridge handlers', () => {
  it('describes the tab', async () => {
    expect(await handlers.describe({})).toEqual({ kind: 'live', name: 'Tab', path: null, dirty: false, model: null, operations: 0 });
  });

  it('applies a batch as one undo step with a toast, or nothing at all', async () => {
    const job = await handlers.apply({ commands: [add('a'), add('b')], label: 'Add two drills' });
    expect(job.operations).toHaveLength(2);
    expect(appStore.getState().past).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith('Claude: Add two drills');
    await expect(handlers.apply({ commands: [add('c'), { type: 'removeOperation', id: 'zz' } as JobCommand], label: 'Bad' })).rejects.toThrow(/^commands\[1\] removeOperation/);
    expect(appStore.getState().job.operations).toHaveLength(2);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('answers run and exportGcode once the pipeline caught up', async () => {
    appStore.setState({ job: applyCommand(createJob('Tab'), add('o1')), camStatus: 'generating' });
    worker.generateInWorker.mockResolvedValue(run());
    const pending = handlers.run({});
    await regenerate();
    const report = await pending;
    expect(report.files).toEqual([{ name: 'job.nc', text: 'G0 X0\n', operationIds: ['o1'], tools: [1], lineCount: 2, seconds: 3, extents: null }]);
    expect(await handlers.exportGcode({})).toEqual({ ok: true, files: [{ name: 'job.nc', text: 'G0 X0\n' }], warnings: [] });
  });

  it('computes boxes on the main thread and asks the worker for the catalog and preview', async () => {
    expect(await handlers.boxes({})).toEqual({ model: null, stock: null });
    expect(await handlers.catalog({})).toBeNull();
    expect(await handlers.previewSvg({ view: 'top' })).toBe('<svg/>');
  });

  it('gives the server the .spon bytes and marks the tab saved after', async () => {
    appStore.setState({ dirty: true });
    const { bytes, token } = await handlers.saveBytes({});
    expect(bytes.length).toBeGreaterThan(0);
    expect(await handlers.markSaved({ token })).toEqual({ saved: true });
    expect(appStore.getState().dirty).toBe(false);
    await expect(handlers.save({})).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('reaches the IndexedDB tool library', async () => {
    const tool = { ...starterLibrary()[1], id: 'via-bridge', name: 'Via bridge', number: 88 };
    await handlers['tools.add']({ tool });
    expect((await handlers['tools.list']({})).some((t) => t.id === 'via-bridge')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/web test handlers`
Expected: FAIL. `./handlers` does not exist.

- [ ] **Step 3: Write the implementation**

`packages/web/src/bridge/handlers.ts`:

```ts
import {
  type BridgeMethod, type BridgeParams, type BridgeResult, camContext, exportOutcome, fromBase64, modelSummary, runReport, type SessionInfo, toBase64,
} from '@sponcam/core';
import { toast } from 'sonner';
import { camCatalog, camPreviewSvg, waitForCamRun } from '../state/cam';
import { importModelOutcome, markSavedIfCurrent, saveToCurrentHandle, sponBytesForSave } from '../state/documents';
import { importProgramBytes } from '../state/programs';
import { appStore } from '../state/store';
import { importLibraryBytes, listLibraryTools, saveLibraryTool } from '../state/toolLibrary';

export type Handlers = { [M in BridgeMethod]: (params: BridgeParams<M>) => Promise<BridgeResult<M>> };

const s = () => appStore.getState();

function describe(): SessionInfo {
  const { job, dirty, fileHandle } = s();
  return { kind: 'live', name: job.name, path: fileHandle?.name ?? null, dirty, model: modelSummary(job.model), operations: job.operations.length };
}

async function currentReport() {
  const { job, run } = await waitForCamRun();
  return runReport(job, run);
}

/** What the tab does for each request from the MCP server. */
export const handlers: Handlers = {
  describe: async () => describe(),
  job: async () => s().job,
  apply: async ({ commands, label }) => {
    const before = s().job;
    s().dispatchBatch(commands);
    if (s().job !== before) toast(`Claude: ${label}`);
    return s().job;
  },
  importModel: ({ fileName, bytes, units, body }) => importModelOutcome(fileName, fromBase64(bytes), units, body),
  run: () => currentReport(),
  catalog: () => camCatalog(),
  boxes: async () => {
    const ctx = camContext(s().job, s().geometry);
    return { model: ctx.model, stock: ctx.stock };
  },
  previewSvg: (options) => camPreviewSvg(options),
  save: async () => ({ name: await saveToCurrentHandle() }),
  saveBytes: async () => {
    const { bytes, token } = sponBytesForSave();
    return { bytes: toBase64(bytes), token };
  },
  markSaved: async ({ token }) => ({ saved: markSavedIfCurrent(token) }),
  exportGcode: async () => exportOutcome(await currentReport()),
  importProgram: async ({ fileName, bytes }) => {
    const program = await importProgramBytes(fileName, fromBase64(bytes));
    if (!program) throw new Error(`Could not add ${fileName} to the job`);
    toast(`Claude: added the program ${fileName}`);
    return program;
  },
  'tools.list': () => listLibraryTools(),
  'tools.add': async ({ tool }) => {
    await saveLibraryTool(tool);
    return {};
  },
  'tools.import': ({ fileName, bytes }) => importLibraryBytes(fileName, fromBase64(bytes)),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/web test handlers && pnpm --filter @sponcam/web typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/bridge/handlers.ts packages/web/src/bridge/handlers.test.ts
git commit -m "feat(web): live bridge handlers answer from the store, the CAM pipeline and the tool library"
```

---

### Task 9: Web — bridge client, status store and lazy controller

**Files:**
- Create: `packages/web/src/bridge/status.ts`
- Create: `packages/web/src/bridge/client.ts`
- Create: `packages/web/src/bridge/controller.ts`
- Test: `packages/web/src/bridge/client.test.ts`, `packages/web/src/bridge/status.test.ts`

**Interfaces:**
- Consumes: `handlers` (Task 8); `BRIDGE_CLOSE`, `BRIDGE_PROTOCOL`, `BUSY_MESSAGE`, `DEFAULT_BRIDGE_PORT`, `HelloParams`, `JobChangedParams` (core).
- Produces:
  - `status.ts`: `type BridgeStatus = 'off' | 'connecting' | 'connected'`; `bridgeStatus` (zustand vanilla store `{ status, message }`); `useBridgeStatus()`; `readSetting(key)`, `writeSetting(key, value | null)`; `ENABLED_KEY = 'spon.bridge.enabled'`, `PORT_KEY = 'spon.bridge.port'`; `bridgeEnabled()`, `bridgeUrl()`; `setBridgeEnabled(on: boolean, takeover: boolean): Promise<void>`; `resumeBridge(): void`
  - `client.ts`: `interface SocketLike { send(data: string): void; close(code?: number, reason?: string): void; onopen: (() => void) | null; onmessage: ((data: string) => void) | null; onclose: ((code: number, reason: string) => void) | null }`; `browserSocket(url: string): SocketLike`; `interface ClientOptions`; `class BridgeClient { start(takeover: boolean): void; stop(): void }`
  - `controller.ts`: `bridgeController: { start(takeover: boolean): void; stop(): void }`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/bridge/client.test.ts`:

```ts
import { BRIDGE_CLOSE, BRIDGE_PROTOCOL, REPLACED_MESSAGE } from '@sponcam/core';
import { describe, expect, it, vi } from 'vitest';
import { BridgeClient, type ClientOptions, type SocketLike } from './client';

class FakeSocket implements SocketLike {
  sent: any[] = [];
  closedWith: [number?, string?] | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closedWith = [code, reason]; }
  serverSays(msg: unknown) { this.onmessage?.(JSON.stringify(msg)); }
}

function setup(handlers: ClientOptions['handlers'] = {}) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const statuses: [string, string | null][] = [];
  const stopped: string[] = [];
  let jobListener: ((p: { title: string; dirty: boolean }) => void) | null = null;
  const client = new BridgeClient({
    url: () => 'ws://127.0.0.1:5197',
    open: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    handlers,
    hello: () => ({ protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: 'Job', dirty: false }),
    onStatus: (status, message) => statuses.push([status, message]),
    onStopped: (message) => stopped.push(message),
    subscribeJob: (listener) => { jobListener = listener; return () => { jobListener = null; }; },
    schedule: (fn, ms) => { timers.push({ fn, ms }); return () => {}; },
  });
  const connect = (i = sockets.length - 1) => { sockets[i].onopen?.(); sockets[i].serverSays({ jsonrpc: '2.0', method: 'welcome', params: { protocol: 1, server: 'x' } }); };
  return { client, sockets, timers, statuses, stopped, connect, job: (p: { title: string; dirty: boolean }) => jobListener?.(p) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('BridgeClient', () => {
  it('says hello with takeover on an explicit start, then reports connected', () => {
    const { client, sockets, statuses, connect } = setup();
    client.start(true);
    sockets[0].onopen?.();
    expect(sockets[0].sent[0]).toEqual({ jsonrpc: '2.0', method: 'hello', params: { protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: 'Job', dirty: false, takeover: true } });
    connect(0);
    expect(statuses.at(-1)).toEqual(['connected', null]);
  });

  it('answers requests one at a time, in order, with results or errors', async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];
    const { client, sockets, connect } = setup({
      job: async () => { order.push('job:start'); await new Promise<void>((r) => { releaseFirst = r; }); order.push('job:end'); return { name: 'J' }; },
      describe: async () => { order.push('describe'); return { kind: 'live' }; },
      apply: async () => { throw new Error('commands[0] updateOperation: No operation with id x'); },
    } as never);
    client.start(false);
    connect();
    const s = sockets[0];
    s.serverSays({ jsonrpc: '2.0', id: 1, method: 'job', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 2, method: 'describe', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 3, method: 'apply', params: {} });
    s.serverSays({ jsonrpc: '2.0', id: 4, method: 'nope', params: {} });
    await flush();
    expect(order).toEqual(['job:start']);
    releaseFirst();
    await flush();
    await flush();
    expect(order).toEqual(['job:start', 'job:end', 'describe']);
    expect(s.sent.slice(1)).toEqual([
      { jsonrpc: '2.0', id: 1, result: { name: 'J' } },
      { jsonrpc: '2.0', id: 2, result: { kind: 'live' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'commands[0] updateOperation: No operation with id x' } },
      { jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Unknown method nope' } },
    ]);
  });

  it('reconnects with backoff from 1 s to 10 s, never taking over', () => {
    const { client, sockets, timers, statuses } = setup();
    client.start(true);
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)!.onclose?.(1006, '');
      timers.at(-1)!.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    sockets.at(-1)!.onopen?.();
    expect(sockets.at(-1)!.sent[0].params.takeover).toBe(false);
    expect(statuses.at(-1)?.[0]).toBe('connecting');
  });

  it('resets the backoff after a successful connection', () => {
    const { client, sockets, timers, connect } = setup();
    client.start(false);
    sockets[0].onclose?.(1006, '');
    timers[0].fn();
    connect(1);
    sockets[1].onclose?.(1006, '');
    expect(timers.map((t) => t.ms)).toEqual([1000, 1000]);
  });

  it('keeps retrying while another tab holds the slot', () => {
    const { client, sockets, timers, statuses, stopped } = setup();
    client.start(false);
    sockets[0].onclose?.(BRIDGE_CLOSE.busy, 'Another Spon tab is connected');
    expect(timers).toHaveLength(1);
    expect(statuses.at(-1)).toEqual(['connecting', 'Another Spon tab is connected']);
    expect(stopped).toEqual([]);
  });

  it('stops for good when replaced or on a protocol mismatch', () => {
    for (const [code, reason] of [[BRIDGE_CLOSE.replaced, REPLACED_MESSAGE], [BRIDGE_CLOSE.protocolMismatch, 'Bridge protocol mismatch: server 1, tab 2.']] as const) {
      const { client, sockets, timers, stopped, connect } = setup();
      client.start(false);
      connect();
      sockets[0].onclose?.(code, reason);
      expect(timers).toEqual([]);
      expect(stopped).toEqual([reason]);
    }
  });

  it('sends jobChanged while connected, and stops cleanly', () => {
    const { client, sockets, timers, statuses, connect, job } = setup();
    client.start(false);
    connect();
    job({ title: 'Renamed', dirty: true });
    expect(sockets[0].sent.at(-1)).toEqual({ jsonrpc: '2.0', method: 'jobChanged', params: { title: 'Renamed', dirty: true } });
    client.stop();
    expect(sockets[0].closedWith).toEqual([1000, 'Disconnected']);
    sockets[0].onclose?.(1000, 'Disconnected');
    expect(timers).toEqual([]);
    expect(statuses.at(-1)).toEqual(['off', null]);
    job({ title: 'After', dirty: false });
    expect(sockets[0].sent.at(-1).params.title).toBe('Renamed');
  });
});

describe('BridgeClient with no handler for a request', () => {
  it('does not throw on malformed messages', () => {
    const { client, sockets, connect } = setup();
    client.start(false);
    connect();
    expect(() => sockets[0].onmessage?.('not json')).not.toThrow();
    vi.restoreAllMocks();
  });
});
```

`packages/web/src/bridge/status.test.ts`:

```ts
import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { bridgeEnabled, bridgeStatus, bridgeUrl, readSetting, writeSetting } from './status';

describe('bridge settings', () => {
  it('works without localStorage (node, private windows) and starts off', () => {
    expect(() => writeSetting('spon.bridge.enabled', '1')).not.toThrow();
    expect(readSetting('spon.bridge.enabled')).toBeNull();
    expect(bridgeEnabled()).toBe(false);
    expect(bridgeUrl()).toBe(`ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`);
    expect(bridgeStatus.getState()).toEqual({ status: 'off', message: null });
  });
});
```

The web unit tests run in the `node` environment. Accessing `localStorage` there throws a `ReferenceError`, which the try/catch must absorb. If a future Node gives `localStorage` a working default, this test must stub it instead. Do not weaken the try/catch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test client status`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Write the implementation**

`packages/web/src/bridge/status.ts`:

```ts
import { DEFAULT_BRIDGE_PORT } from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type BridgeStatus = 'off' | 'connecting' | 'connected';
export interface BridgeView { status: BridgeStatus; message: string | null }

/** Always loaded and tiny: the status bar reads it. The client itself loads on first enable. */
export const bridgeStatus = createStore<BridgeView>(() => ({ status: 'off', message: null }));
export const useBridgeStatus = (): BridgeView => useStore(bridgeStatus);

export const ENABLED_KEY = 'spon.bridge.enabled';
export const PORT_KEY = 'spon.bridge.port';

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the bridge just won't be remembered
  }
}

export const bridgeEnabled = (): boolean => readSetting(ENABLED_KEY) === '1';

export function bridgeUrl(): string {
  const port = Number(readSetting(PORT_KEY));
  return `ws://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_BRIDGE_PORT}`;
}

/** Turns the bridge on or off and remembers it. `takeover`: an explicit click takes the connection from another tab. */
export async function setBridgeEnabled(on: boolean, takeover: boolean): Promise<void> {
  writeSetting(ENABLED_KEY, on ? '1' : null);
  const { bridgeController } = await import('./controller');
  if (on) bridgeController.start(takeover);
  else bridgeController.stop();
}

/** On startup: reconnects if the user left the bridge on. Never takes over another tab. */
export function resumeBridge(): void {
  if (bridgeEnabled()) void setBridgeEnabled(true, false);
}
```

`packages/web/src/bridge/client.ts`:

```ts
import { BRIDGE_CLOSE, BUSY_MESSAGE, type HelloParams, type JobChangedParams } from '@sponcam/core';
import type { BridgeStatus } from './status';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
}

/** The browser WebSocket behind the SocketLike shape. */
export function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null, onmessage: null, onclose: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (e) => socket.onmessage?.(String(e.data));
  ws.onclose = (e) => socket.onclose?.(e.code, e.reason);
  return socket;
}

export interface ClientOptions {
  url(): string;
  open(url: string): SocketLike;
  handlers: Record<string, ((params: any) => Promise<unknown>) | undefined>;
  hello(): Omit<HelloParams, 'takeover'>;
  onStatus(status: BridgeStatus, message: string | null): void;
  /** The server ended the connection for good (replaced by another tab, or a protocol mismatch). */
  onStopped(message: string): void;
  subscribeJob(listener: (params: JobChangedParams) => void): () => void;
  schedule?(fn: () => void, ms: number): () => void;
}

const MIN_DELAY = 1000;
const MAX_DELAY = 10_000;
const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Connects the tab to the MCP server's bridge and answers its requests one at a time. */
export class BridgeClient {
  private enabled = false;
  private socket: SocketLike | null = null;
  private delay = MIN_DELAY;
  private cancelRetry: (() => void) | null = null;
  private unsubscribeJob: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ClientOptions) {}

  start(takeover: boolean): void {
    this.stopSocket();
    this.enabled = true;
    this.delay = MIN_DELAY;
    this.connect(takeover);
  }

  stop(): void {
    this.enabled = false;
    this.stopSocket();
    this.options.onStatus('off', null);
  }

  private stopSocket(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.unsubscribeJob?.();
    this.unsubscribeJob = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close(1000, 'Disconnected');
    }
  }

  private connect(takeover: boolean, message: string | null = null): void {
    this.options.onStatus('connecting', message);
    const socket = this.options.open(this.options.url());
    this.socket = socket;
    const send = (msg: unknown) => socket.send(JSON.stringify(msg));
    socket.onopen = () => send({ jsonrpc: '2.0', method: 'hello', params: { ...this.options.hello(), takeover } });
    socket.onmessage = (data) => this.receive(data, send);
    socket.onclose = (code, reason) => this.closed(socket, code, reason);
  }

  private receive(data: string, send: (msg: unknown) => void): void {
    let msg: { id?: number; method?: string; params?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.method === 'welcome') {
      this.delay = MIN_DELAY;
      this.unsubscribeJob?.();
      this.unsubscribeJob = this.options.subscribeJob((params) => send({ jsonrpc: '2.0', method: 'jobChanged', params }));
      this.options.onStatus('connected', null);
      return;
    }
    if (typeof msg.id !== 'number' || !msg.method) return;
    const { id, method, params } = msg;
    this.queue = this.queue.then(async () => {
      const handler = this.options.handlers[method];
      if (!handler) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
        return;
      }
      try {
        send({ jsonrpc: '2.0', id, result: await handler(params ?? {}) });
      } catch (err) {
        send({ jsonrpc: '2.0', id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } });
      }
    });
  }

  private closed(socket: SocketLike, code: number, reason: string): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.unsubscribeJob?.();
    this.unsubscribeJob = null;
    if (!this.enabled) return;
    if (code === BRIDGE_CLOSE.replaced || code === BRIDGE_CLOSE.protocolMismatch) {
      this.enabled = false;
      this.options.onStopped(reason);
      return;
    }
    const message = code === BRIDGE_CLOSE.busy ? BUSY_MESSAGE : null;
    this.options.onStatus('connecting', message);
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY);
    this.cancelRetry = (this.options.schedule ?? defaultSchedule)(() => {
      this.cancelRetry = null;
      if (this.enabled) this.connect(false, message);
    }, delay);
  }
}
```

In the test "stops cleanly", `stop()` detaches `onclose` before closing, so the later `sockets[0].onclose?.(…)` call is a no-op on `null`. That is why no retry gets scheduled.

`packages/web/src/bridge/controller.ts`:

```ts
import { BRIDGE_PROTOCOL } from '@sponcam/core';
import { appStore } from '../state/store';
import { BridgeClient, browserSocket } from './client';
import { handlers } from './handlers';
import { bridgeStatus, bridgeUrl, ENABLED_KEY, writeSetting } from './status';

/** Loaded on first enable (see setBridgeEnabled): the client, the handlers and the socket stay out of the main bundle until then. */
const client = new BridgeClient({
  url: bridgeUrl,
  open: browserSocket,
  handlers,
  hello: () => ({ protocol: BRIDGE_PROTOCOL, app: 'spon-web', title: appStore.getState().job.name, dirty: appStore.getState().dirty }),
  onStatus: (status, message) => bridgeStatus.setState({ status, message }),
  onStopped: (message) => {
    writeSetting(ENABLED_KEY, null);
    bridgeStatus.setState({ status: 'off', message });
  },
  subscribeJob: (listener) => appStore.subscribe((s, prev) => {
    if (s.job.name !== prev.job.name || s.dirty !== prev.dirty) listener({ title: s.job.name, dirty: s.dirty });
  }),
});

export const bridgeController = {
  start: (takeover: boolean) => client.start(takeover),
  stop: () => client.stop(),
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test client status && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/bridge
git commit -m "feat(web): bridge client with backoff, in-order requests and takeover handling, loaded on first enable"
```

---

### Task 10: Web — the "Claude" status bar item and startup

**Files:**
- Create: `packages/web/src/bridge/ClaudeStatus.tsx`
- Modify: `packages/web/src/layout/StatusBar.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `useBridgeStatus`, `setBridgeEnabled`, `resumeBridge` (Task 9).
- Produces: a status bar button with `data-testid="bridge-toggle"`, `data-status` = `off | connecting | connected`, and the visible message in `data-testid="bridge-message"`.

- [ ] **Step 1: Write the component**

`packages/web/src/bridge/ClaudeStatus.tsx`:

```tsx
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setBridgeEnabled, useBridgeStatus } from './status';

const LABEL = { off: 'Claude: off', connecting: 'Claude: connecting…', connected: 'Claude: connected' } as const;

/** Lets Claude Code drive this tab through the Spon MCP server. A click turns it on (taking over from another tab) or off. */
export function ClaudeStatus() {
  const { status, message } = useBridgeStatus();
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1"
        data-testid="bridge-toggle"
        data-status={status}
        title={status === 'off' ? 'Let Claude Code drive this tab through the Spon MCP server' : 'Disconnect Claude'}
        onClick={() => void setBridgeEnabled(status === 'off', true)}
      >
        <Bot className={cn('size-3.5', status === 'connected' && 'text-emerald-500', status === 'connecting' && 'animate-pulse')} />
        {LABEL[status]}
      </Button>
      {message && <span className="text-amber-500" data-testid="bridge-message">{message}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Mount it and resume on startup**

In `packages/web/src/layout/StatusBar.tsx`, import `ClaudeStatus` from `@/bridge/ClaudeStatus` and render `<ClaudeStatus />` directly before `<div className="ml-auto">`.

In `packages/web/src/App.tsx`, import `resumeBridge` from `@/bridge/status` and call it in the startup `useEffect`, after `loadToolLibrary`:

```ts
    resumeBridge();
```

`resumeBridge` only imports the controller when the setting is on, so the main bundle never includes the client.

- [ ] **Step 3: Verify the build keeps the client lazy**

Run: `pnpm --filter @sponcam/web typecheck && pnpm build`
Expected: PASS. Then check that the client is not in the entry chunk:

Run: `grep -l "Unknown method" packages/web/dist/assets/*.js`
Expected: one file, a separate chunk (not `index-*.js`). If the string appears in the `index-*.js` entry chunk, something imports `client.ts`, `handlers.ts` or `controller.ts` statically: find it with `grep -rn "bridge/\(client\|handlers\|controller\)" packages/web/src` and make it a dynamic import.

- [ ] **Step 4: Run the existing end-to-end tests**

Run: `pnpm e2e`
Expected: PASS (all existing specs). The status bar item must not shift any existing test ids.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/bridge/ClaudeStatus.tsx packages/web/src/layout/StatusBar.tsx packages/web/src/App.tsx
git commit -m "feat(web): Claude status bar item turns the live bridge on and off"
```

---

### Task 11: Playwright — Claude drives the open tab

**Files:**
- Modify: `packages/web/package.json` (add `"@modelcontextprotocol/sdk": "^1.31.0"` to `devDependencies`; run `pnpm install`)
- Create: `packages/web/e2e/live.spec.ts`

**Interfaces:**
- Consumes: the built `packages/mcp/dist/spon-mcp.js` (`--port`), the tab's `bridge-toggle`, the `spon.bridge.port` setting, and the operation rows `[data-testid^="op-row-"]`.

- [ ] **Step 1: Write the test**

`packages/web/e2e/live.spec.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from '@playwright/test';

const MCP = path.resolve(import.meta.dirname, '../../mcp');
const DIST = path.join(MCP, 'dist', 'spon-mcp.js');
const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');
const PORT = 5196;
const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');

test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(MCP, 'scripts', 'build.mjs')], { cwd: MCP, stdio: 'pipe' });
});

test('Claude drives the open tab: each tool call is one undo step, the preview renders, closing the tab is reported', async ({ page }) => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-live-'));
  fs.copyFileSync(path.join(FIXTURES, 'cam-part.dxf'), path.join(dir, 'cam-part.dxf'));
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [DIST, '--port', String(PORT)], cwd: dir, env: { ...env, SPON_TOOL_LIBRARY: path.join(dir, 'tools.json') }, stderr: 'pipe',
  });
  const client = new Client({ name: 'spon-live-e2e', version: '0.0.0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    if (r.isError) throw new Error(`${name}: ${text(r)}`);
    return r;
  };
  try {
    await page.addInitScript((port) => localStorage.setItem('spon.bridge.port', String(port)), PORT);
    await page.goto('/');
    await page.getByTestId('bridge-toggle').click();
    await expect(page.getByTestId('bridge-toggle')).toHaveAttribute('data-status', 'connected');

    await call('use_live_tab');
    await call('import_model', { path: 'cam-part.dxf' });
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 6 } } }], label: 'Stock 6 mm' });
    await expect(page.getByText('Claude: Stock 6 mm')).toBeVisible();
    const catalog = (await call('describe_geometry')).structuredContent as { contours: { handle: string; layer: string }[] };
    const outline = catalog.contours.filter((c) => c.layer === 'OUTLINE').map((c) => c.handle);
    await call('add_operation', { type: 'profile', tool: 'starter-flat-6', geometry: outline, params: { tabs: { enabled: true } } });
    await expect(page.locator('[data-testid^="op-row-"]')).toHaveCount(1);
    await expect(page.getByText(/Claude: Add Profile on/)).toBeVisible();

    const generated = (await call('generate')).structuredContent as { operations: { status: string }[] };
    expect(generated.operations.map((o) => o.status)).not.toContain('error');
    const image = (await call('render_preview', { view: 'iso' })).content[0];
    expect(image.type === 'image' && Array.from(Buffer.from(image.data, 'base64').subarray(0, 4))).toEqual([137, 80, 78, 71]);

    // one Ctrl+Z undoes the whole add_operation call
    await page.locator('body').press('Control+z');
    await expect(page.locator('[data-testid^="op-row-"]')).toHaveCount(0);
    expect((await call('get_job', { section: 'operations' })).structuredContent).toEqual({ operations: [] });

    await page.close();
    await expect.poll(async () => text((await client.callTool({ name: 'status', arguments: {} })) as CallToolResult)).toContain('No job open');
    expect((await client.callTool({ name: 'new_job', arguments: {} })).isError).toBeFalsy();
  } finally {
    await client.close();
  }
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @sponcam/web exec playwright test live`
Expected: PASS. If the toggle never reaches `connected`, check the MCP stderr (switch `stderr: 'pipe'` to `'inherit'` while debugging): the page origin must be `http://localhost:5199`, which is in the default allow-list.

If pressing `Control+z` on `body` does not reach the app's shortcut handler, click an empty area of the status bar first (`page.getByTestId('cursor').click()`), then use `page.keyboard.press('Control+z')`.

- [ ] **Step 3: Run the whole e2e suite**

Run: `pnpm e2e`
Expected: PASS (all specs, including `live.spec.ts`).

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml packages/web/e2e/live.spec.ts
git commit -m "test(e2e): Claude drives the open tab over the live bridge"
```

---

### Task 12: Docs and verification

**Files:**
- Modify: `.claude/skills/spon-dev/SKILL.md`
- Modify: `packages/mcp/README.md` (if anything from Task 5 is missing)

- [ ] **Step 1: Update the dev skill**

In `.claude/skills/spon-dev/SKILL.md`:
- Add a row to the commands table: `| Live bridge (dev) | run the MCP server, open http://localhost:5173 and click **Claude** in the status bar (port 5197; \`--port\` / \`SPON_BRIDGE_PORT\` to change) |`.
- Add these rules under "Rules that are easy to break":
  - `MCP tests start bridges on port 0 and Playwright uses 5196: never bind 5197 in tests (the user's own Claude session may hold it).`
  - `The web bridge client (bridge/client.ts, handlers.ts, controller.ts) must only be reached through import(): the main bundle stays unchanged for users who never connect.`
  - `Bridge wire types live in core/src/bridge/protocol.ts; change them on both ends together and bump BRIDGE_PROTOCOL when a change is not backwards compatible.`

- [ ] **Step 2: Full verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (core, web, mcp).
Run: `pnpm build`
Expected: PASS.
Run: `pnpm e2e`
Expected: PASS.
Run: `pnpm --filter @sponcam/mcp licenses list --prod | grep -E "GPL" | grep -v LGPL`
Expected: no output. `ws` is MIT; the only copyleft entries remain `occt-import-js` (LGPL-2.1) and `@resvg/resvg-wasm` (MPL-2.0).

- [ ] **Step 3: Manual acceptance check (spec §9, criterion 5)**

With the user's dev server on 5173 running (do not start or stop it yourself):
1. `pnpm mcp:build`. Register the server if it isn't already: `claude mcp add spon -- node <repo>/packages/mcp/dist/spon-mcp.js`.
2. In the tab, click **Claude**. It shows "Claude: connected".
3. From Claude Code, ask: "use the live tab; import part.dxf, profile the outline with tabs, pocket the island, drill the holes, post for GRBL".
4. Each tool call shows a "Claude: …" toast, and each is one Ctrl+Z.
5. Close the tab. `status` reports no job and no tab, and `new_job` still works.

Report the result to the user; this step needs their browser.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/spon-dev/SKILL.md packages/mcp/README.md
git commit -m "docs: live bridge in the dev skill and the MCP README"
```
